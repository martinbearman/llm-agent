import type { UIMessage } from "ai";
import { convertToModelMessages, streamText, stepCountIs } from "ai";
import { z } from "zod";
import { Langfuse } from "langfuse";
import { env } from "~/env";
import { auth } from "~/server/auth";
import { model } from "~/model";
import { searchSerper } from "~/serper";
import { crawlMultipleUrls } from "~/server/scraper";
import {
  getDailyRequestCount,
  getRequestLimitPerDay,
  getUserById,
  insertRequestLog,
  upsertChat,
} from "~/server/db/queries";

const langfuse = new Langfuse({
  environment: env.NODE_ENV,
});

function appendResponseMessages({
  messages,
  responseMessages,
}: {
  messages: UIMessage[];
  // `response.messages` from `streamText` is compatible with `UIMessage[]` for our use.
  responseMessages: UIMessage[];
}): UIMessage[] {
  return [...messages, ...responseMessages];
}

export const maxDuration = 60;

function normalizeMessage(message: UIMessage): UIMessage {
  if (message.parts && message.parts.length > 0) {
    return message;
  }

  // Some SDK messages may populate `content` instead of `parts`.
  // `content` can be:
  // - a string
  // - an array of text/tool parts (newer SDKs)
  // Normalize both into `parts`.
  // @ts-expect-error `content` may exist on the underlying message type.
  const content = message.content;

  if (typeof content === "string" && content.trim().length > 0) {
    return {
      ...message,
      parts: [{ type: "text", text: content }],
    };
  }

  if (Array.isArray(content) && content.length > 0) {
    return {
      ...message,
      // We trust the SDK's content parts shape here.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parts: content as any,
    };
  }

  // Fallback: store an empty parts array instead of `null`.
  return {
    ...message,
    parts: [],
  };
}

export async function POST(request: Request) {

  const session = await auth();

  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const user = await getUserById(session.user.id);

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await request.json()) as {
    messages: Array<UIMessage>;
    chatId: string;
    isNewChat: boolean;
  };

  const rawMessages = body.messages;
  const chatId = body.chatId;
  const isNewChat = body.isNewChat;

  // Ensure all incoming messages have non-null `parts` before we touch the DB.
  const messages = rawMessages.map(normalizeMessage);

  const getChatTitleFromMessages = (allMessages: Array<UIMessage>): string => {
    const firstUserMessage = allMessages.find(
      (message) => message.role === "user",
    );

    if (!firstUserMessage) {
      return "New Chat";
    }

    // Messages in this app use parts with text content
    const textPart = firstUserMessage.parts?.find(
      (part) => part.type === "text" && "text" in part,
    ) as { type: "text"; text: string } | undefined;

    const titleText = textPart?.text.trim();

    if (!titleText) {
      return "New Chat";
    }

    return titleText.length > 100
      ? `${titleText.slice(0, 100)}...`
      : titleText;
  };

  if (!user.isAdmin) {
    const dailyLimit = getRequestLimitPerDay();
    
    // If limit is 0, allow unlimited requests
    if (dailyLimit > 0) {
      const requestCount = await getDailyRequestCount(user.id);

      if (requestCount >= dailyLimit) {
        return new Response("Too Many Requests", { status: 429 });
      }
    }
  }

  await insertRequestLog(user.id);

  // If this is a brand new chat, create it immediately
  // so that we have it persisted even if the stream is cancelled or fails.
  if (isNewChat) {
    const initialTitle = getChatTitleFromMessages(messages);

    await upsertChat({
      userId: user.id,
      chatId,
      title: initialTitle,
      messages,
    });
  }

  // Filter out tool role messages - convertToModelMessages doesn't support them,
  // and the SDK will reconstruct tool calls from assistant messages automatically
  const messagesWithoutTool = messages.filter(
    (message) => (message.role as string) !== "tool",
  );

  const modelMessages = convertToModelMessages(messagesWithoutTool);

  const trace = langfuse.trace({
    sessionId: chatId,
    name: "chat",
    userId: session.user.id,
  });

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

  const result = streamText({
    model,
    messages: modelMessages,
    stopWhen: stepCountIs(10),
    system: `You are a helpful AI assistant with access to web search and web scraping capabilities.

Current date and time: ${formattedDate} (ISO: ${currentDate})

When answering questions, you must:
- Always use the searchWeb tool to find current and accurate information
- Always use the scrapePages tool on a diverse set of high-signal URLs (for example, the top 4–6 results from searchWeb), ideally from different domains, to retrieve the full page content in markdown before composing your final answer
- When selecting URLs for scrapePages, prefer diversity of sources (e.g. news sites, blogs, documentation, reference sites) rather than multiple pages from the same domain, unless the topic is highly specialized
- If there are many relevant results, choose 4–6 URLs to scrape in a single scrapePages call; if fewer are available, scrape all that are clearly relevant
- Cite your sources with inline links using markdown format: [source text](url)
- Provide comprehensive answers based on both the search results and the scraped page content
- If the user asks about current events, recent information, or anything that requires up-to-date data, you must use the searchWeb tool and then use scrapePages on at least one relevant result, preferably 4–6 diverse URLs when available
- When users ask for up-to-date information, pay attention to the publication dates of search results and prioritize more recent sources. Use the current date (${formattedDate}) to determine how recent information is and inform users about the recency of the information you're providing
- Respect that scrapePages may return errors when a site cannot be crawled (for example due to robots.txt); in that case, explain this limitation to the user and fall back to other available information`,
    tools: {
      searchWeb: {
        inputSchema: z.object({
          query: z.string().describe("The query to search the web for"),
        }),
        execute: async ({ query }, { abortSignal }) => {
          const results = await searchSerper(
            { q: query, num: 10 },
            abortSignal,
          );

          return results.organic.map((result) => ({
            title: result.title,
            link: result.link,
            snippet: result.snippet,
            date: result.date,
          }));
        },
      },
      scrapePages: {
        inputSchema: z.object({
          urls: z
            .array(z.string().url())
            .min(1)
            .describe("A list of absolute URLs to fetch and convert to markdown"),
        }),
        execute: async ({ urls }, { abortSignal }) => {
          try {
            const crawlResult = await crawlMultipleUrls(urls);

            // Always return the full structured crawl result so the model
            // can see both successes and errors, and additionally provide
            // a flattened `sources` array that is easy for the UI to consume.
            const sources =
              crawlResult.success === true
                ? crawlResult.results.map(({ url, result }) => ({
                    url,
                    content: result.data,
                    sourceType: result.sourceType,
                  }))
                : crawlResult.results.map(({ url, result }) => ({
                    url,
                    content: result.success ? result.data : null,
                    // Only successful crawls will have a `sourceType`
                    sourceType: result.success ? result.sourceType : null,
                  }));

            return {
              ...crawlResult,
              sources,
            };
          } catch (error) {
            // Return a structured error response that the model can understand
            return {
              success: false,
              results: urls.map((url: string) => ({
                url,
                result: {
                  success: false,
                  error: error instanceof Error ? error.message : "Unknown error occurred",
                },
              })),
              error: error instanceof Error ? error.message : "Failed to scrape pages",
              sources: urls.map((url: string) => ({
                url,
                content: null,
                sourceType: null,
              })),
            };
          }
        },
      },
    },
    experimental_telemetry: {
      isEnabled: true,
      functionId: "agent",
      metadata: {
        langfuseTraceId: trace.id,
      },
    },
    onFinish: async ({ response }) => {
      const rawResponseMessages = response.messages as unknown as UIMessage[];

      // Ensure all response messages have non-null `parts` so they can be
      // safely persisted to the database (the `parts` column is non-nullable).
      const responseMessages: UIMessage[] = rawResponseMessages.map(
        normalizeMessage,
      );

      const updatedMessages = appendResponseMessages({
        messages,
        responseMessages,
      });

      const title = getChatTitleFromMessages(updatedMessages);

      // Save the entire chat message history by replacing all existing messages
      // with the updated messages array for this chat.
      await upsertChat({
        userId: user.id,
        chatId,
        title,
        messages: updatedMessages,
      });

      await langfuse.flushAsync();
    },
  });

  return result.toUIMessageStreamResponse();
}

