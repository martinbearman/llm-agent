import {
  type StreamTextResult,
  type UIMessage,
  convertToModelMessages,
  generateObject,
} from "ai";
import { z } from "zod";
import { model } from "~/model";
import { runAgentLoop } from "~/run-agent-loop";
import type { RequestLocation, SystemContext } from "~/system-context";

type ModelMessage = ReturnType<typeof convertToModelMessages>[number];

function getTextFromMessage(msg: ModelMessage): string {
  const content = (msg as { content: unknown }).content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    const textParts = content
      .filter(
        (part: { type?: string; text?: string }) =>
          part.type === "text" && typeof part.text === "string",
      )
      .map((part: { text: string }) => part.text);
    return textParts.join(" ").trim();
  }
  return "";
}

function getUserQuestionFromMessages(messages: ModelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;
    if (msg.role === "user") {
      return getTextFromMessage(msg);
    }
  }
  return "";
}

/**
 * Format all messages except the last user message as conversation history,
 * so the agent has context for follow-up questions like "that's not working".
 */
function getConversationHistoryFromMessages(messages: ModelMessage[]): string {
  if (messages.length <= 1) return "";

  const lastUserIndex = messages.findLastIndex(
    (msg) => msg && msg.role === "user",
  );
  if (lastUserIndex <= 0) return "";

  const priorMessages = messages.slice(0, lastUserIndex);
  const lines = priorMessages.map((msg) => {
    if (!msg) return "";
    const role = msg.role === "user" ? "User" : "Assistant";
    const text = getTextFromMessage(msg);
    return `${role}: ${text}`;
  });

  return lines.filter(Boolean).join("\n\n");
}

export interface SearchAction {
  type: "search";
  title: string;
  reasoning: string;
  query: string;
}

export interface ScrapeAction {
  type: "scrape";
  title: string;
  reasoning: string;
  urls: string[];
}

export interface AnswerAction {
  type: "answer";
  title: string;
  reasoning: string;
}

export type Action =
  | SearchAction
  | ScrapeAction
  | AnswerAction;

export type OurMessageAnnotation = {
  type: "NEW_ACTION";
  action: Action;
};

export type OurUIMessage = UIMessage<
  never,
  { NEW_ACTION: { action: Action } },
  never
>;

export const actionSchema = z.object({
  title: z
    .string()
    .describe(
      "The title of the action, to be displayed in the UI. Be extremely concise. 'Searching Saka's injury history', 'Checking HMRC industrial action', 'Comparing toaster ovens'",
    ),
  reasoning: z.string().describe("The reason you chose this step."),
  type: z
    .enum(["search", "scrape", "answer"])
    .describe(
      `The type of action to take.
      - 'search': Search the web for more information.
      - 'scrape': Scrape a URL.
      - 'answer': Answer the user's question and complete the loop.`,
    ),
  query: z
    .string()
    .describe(
      "The query to search for. Only required if type is 'search'.",
    )
    .optional(),
  urls: z
    .array(z.string())
    .describe(
      "The URLs to scrape. Only required if type is 'scrape'.",
    )
    .optional(),
});

export async function streamFromDeepSearch(opts: {
  langfuseTraceId?: string;
  messages: ModelMessage[];
  requestLocation?: RequestLocation;
  onFinish?: (args: { response: { messages: unknown[] } }) => void | Promise<void>;
  writeMessageAnnotation?: (annotation: OurMessageAnnotation) => void;
}): Promise<StreamTextResult<Record<string, never>, string>> {
  
  const userQuestion = getUserQuestionFromMessages(opts.messages);
  const conversationHistory = getConversationHistoryFromMessages(opts.messages);
  
  return runAgentLoop(userQuestion, {
    conversationHistory,
    requestLocation: opts.requestLocation,
    langfuseTraceId: opts.langfuseTraceId,
    onFinish: opts.onFinish,
    writeMessageAnnotation: opts.writeMessageAnnotation,
  });
}

export async function askDeepSearch(messages: UIMessage[]) {
  // Filter out tool role messages - convertToModelMessages doesn't support them,
  // and the SDK will reconstruct tool calls from assistant messages automatically
  const messagesWithoutTool = messages.filter(
    (message) => (message.role as string) !== "tool",
  );

  const modelMessages = convertToModelMessages(messagesWithoutTool);

  const result = await streamFromDeepSearch({
    messages: modelMessages,
    onFinish: () => {}, // just a stub - no langfuseTraceId so evals don't capture traces
  });

  // Consume the stream - without this,
  // the stream will never finish
  await result.consumeStream();

  return await result.text;
}

function getNextActionSystemPrompt(
  formattedDate: string,
  currentDate: string,
  requestLocationPrompt: string,
) {
  return `You are an unhelpful and rude AI assistant with access to web search and web scraping capabilities.

Current date and time: ${formattedDate} (ISO: ${currentDate})

${requestLocationPrompt}

Your job is to choose the next action based on the context provided. You must pick exactly one:

- **search**: Use when you need more information. Provide a clear, specific query. For current events or up-to-date data, search first. Consider publication dates and recency.
- **scrape**: Use when you have search results with URLs that need full page content. Provide a diverse set of high-signal URLs (e.g. from different domains: news, docs, blogs). Prefer scraping multiple relevant URLs when available.
- **answer**: Use when you have enough information from search and scraped content to answer the user's question. You will then cite sources with markdown links and complete the loop.

Choose 'answer' only when the context already contains enough search and scrape results to give a comprehensive, well-sourced response.`;
}

function parseNextActionResult(
  raw: z.infer<typeof actionSchema>,
): Action {
  const title = raw.title ?? "";
  const reasoning = raw.reasoning ?? "";
  if (raw.type === "search") {
    return {
      type: "search",
      title,
      reasoning,
      query: raw.query ?? "",
    };
  }
  if (raw.type === "scrape") {
    return {
      type: "scrape",
      title,
      reasoning,
      urls: raw.urls ?? [],
    };
  }
  return { type: "answer", title, reasoning };
}

export const getNextAction = async (
  context: SystemContext,
  opts?: { langfuseTraceId?: string },
): Promise<Action> => {
  const currentDate = new Date().toISOString();
  const formattedDate = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    timeZoneName: "short",
  });

  const langfuseTraceId = opts?.langfuseTraceId;
  const conversationBlock =
    context.getConversationHistory().trim().length > 0
      ? `Previous conversation:\n${context.getConversationHistory()}\n\nCurrent user question: ${context.getUserQuestion()}`
      : `User question: ${context.getUserQuestion()}`;

  const result = await generateObject({
    model,
    schema: actionSchema,
    prompt: `${getNextActionSystemPrompt(
      formattedDate,
      currentDate,
      context.getRequestLocationPrompt(),
    )}

${conversationBlock}

Here is the context:

${context.getQueryHistory()}

${context.getScrapeHistory()}`,
    ...(langfuseTraceId != null && {
      experimental_telemetry: {
        isEnabled: true,
        functionId: "agent-loop-get-next-action",
        metadata: {
          langfuseTraceId,
        },
      },
    }),
  });

  return parseNextActionResult(result.object);
};

