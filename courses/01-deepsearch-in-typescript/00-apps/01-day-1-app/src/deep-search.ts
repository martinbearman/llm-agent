import {
  type StreamTextResult,
  type TelemetrySettings,
  type UIMessage,
  convertToModelMessages,
  generateObject,
} from "ai";
import { z } from "zod";
import { model } from "~/model";
import { runAgentLoop } from "~/run-agent-loop";
import type { SystemContext } from "~/system-context";

type ModelMessage = ReturnType<typeof convertToModelMessages>[number];

function getUserQuestionFromMessages(messages: ModelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;
    if (msg.role === "user") {
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
  }
  return "";
}

export interface SearchAction {
  type: "search";
  query: string;
}

export interface ScrapeAction {
  type: "scrape";
  urls: string[];
}

export interface AnswerAction {
  type: "answer";
}

export type Action =
  | SearchAction
  | ScrapeAction
  | AnswerAction;

export const actionSchema = z.object({
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
      "The query to search for. Required if type is 'search'.",
    )
    .optional(),
  urls: z
    .array(z.string())
    .describe(
      "The URLs to scrape. Required if type is 'scrape'.",
    )
    .optional(),
});

export async function streamFromDeepSearch(opts: {
  messages: ModelMessage[];
  onFinish?: (args: { response: { messages: unknown[] } }) => void | Promise<void>;
  telemetry: TelemetrySettings;
}): Promise<StreamTextResult<Record<string, never>, string>> {
  const userQuestion = getUserQuestionFromMessages(opts.messages);
  return runAgentLoop(userQuestion, { onFinish: opts.onFinish });
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
    onFinish: () => {}, // just a stub
    telemetry: {
      isEnabled: false,
    },
  });

  // Consume the stream - without this,
  // the stream will never finish
  await result.consumeStream();

  return await result.text;
}

function getNextActionSystemPrompt(formattedDate: string, currentDate: string) {
  return `You are an unhelpful and rude AI assistant with access to web search and web scraping capabilities.

Current date and time: ${formattedDate} (ISO: ${currentDate})

Your job is to choose the next action based on the context provided. You must pick exactly one:

- **search**: Use when you need more information. Provide a clear, specific query. For current events or up-to-date data, search first. Consider publication dates and recency.
- **scrape**: Use when you have search results with URLs that need full page content. Provide a diverse set of high-signal URLs (e.g. from different domains: news, docs, blogs). Prefer scraping multiple relevant URLs when available.
- **answer**: Use when you have enough information from search and scraped content to answer the user's question. You will then cite sources with markdown links and complete the loop.

Choose 'answer' only when the context already contains enough search and scrape results to give a comprehensive, well-sourced response.`;
}

function parseNextActionResult(
  raw: z.infer<typeof actionSchema>,
): Action {
  if (raw.type === "search") {
    return { type: "search", query: raw.query ?? "" };
  }
  if (raw.type === "scrape") {
    return { type: "scrape", urls: raw.urls ?? [] };
  }
  return { type: "answer" };
}

export const getNextAction = async (
  context: SystemContext,
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

  const result = await generateObject({
    model,
    schema: actionSchema,
    prompt: `${getNextActionSystemPrompt(formattedDate, currentDate)}

User question: ${context.getUserQuestion()}

Here is the context:

${context.getQueryHistory()}

${context.getScrapeHistory()}`,
  });

  return parseNextActionResult(result.object);
};

