import type { UIMessage } from "ai";
import { convertToModelMessages, streamText, stepCountIs } from "ai";
import { z } from "zod";
import { auth } from "~/server/auth";
import { model } from "~/model";
import { searchSerper } from "~/serper";
import {
  getDailyRequestCount,
  getRequestLimitPerDay,
  getUserById,
  insertRequestLog,
  upsertChat,
} from "~/server/db/queries";

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
    id?: string;
  };

  const rawMessages = body.messages;
  const chatId = body.id;

  // Ensure all incoming messages have non-null `parts` before we touch the DB.
  const messages = rawMessages.map(normalizeMessage);

  const effectiveChatId = chatId ?? crypto.randomUUID();

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
    const requestCount = await getDailyRequestCount(user.id);

    if (requestCount >= dailyLimit) {
      return new Response("Too Many Requests", { status: 429 });
    }
  }

  await insertRequestLog(user.id);

  // If this is a brand new chat (no chatId provided), create it immediately
  // so that we have it persisted even if the stream is cancelled or fails.
  if (!chatId) {
    const initialTitle = getChatTitleFromMessages(messages);

    await upsertChat({
      userId: user.id,
      chatId: effectiveChatId,
      title: initialTitle,
      messages,
    });
  }

  const modelMessages = convertToModelMessages(messages);

  const result = streamText({
    model,
    messages: modelMessages,
    stopWhen: stepCountIs(10),
    system: `You are a helpful AI assistant with access to web search capabilities. 
When answering questions, you should:
- Always use the searchWeb tool to find current and accurate information
- Cite your sources with inline links using markdown format: [source text](url)
- Provide comprehensive answers based on the search results
- If the user asks about current events, recent information, or anything that requires up-to-date data, you must use the search tool`,
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
          }));
        },
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
        chatId: effectiveChatId,
        title,
        messages: updatedMessages,
      });
    },
  });

  return result.toUIMessageStreamResponse();
}

