import type { UIMessage } from "ai";
import { convertToModelMessages } from "ai";
import { Langfuse } from "langfuse";
import { env } from "~/env";
import { auth } from "~/server/auth";
import { streamFromDeepSearch } from "~/deep-search";
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

  // Create trace early, before first DB call
  const trace = langfuse.trace({
    name: "chat",
    userId: session.user.id,
  });

  const getUserByIdSpan = trace.span({
    name: "get-user-by-id",
    input: {
      userId: session.user.id,
    },
  });

  const user = await getUserById(session.user.id);

  getUserByIdSpan.end({
    output: {
      user: user ? { id: user.id, isAdmin: user.isAdmin } : null,
    },
  });

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

  // Update trace with sessionId and input messages
  trace.update({
    sessionId: chatId,
    input: {
      messages,
      messageCount: messages.length,
    },
  });

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
      const getDailyRequestCountSpan = trace.span({
        name: "get-daily-request-count",
        input: {
          userId: user.id,
        },
      });

      const requestCount = await getDailyRequestCount(user.id);

      getDailyRequestCountSpan.end({
        output: {
          requestCount,
        },
      });

      if (requestCount >= dailyLimit) {
        return new Response("Too Many Requests", { status: 429 });
      }
    }
  }

  const insertRequestLogSpan = trace.span({
    name: "insert-request-log",
    input: {
      userId: user.id,
    },
  });

  await insertRequestLog(user.id);

  insertRequestLogSpan.end({
    output: {
      success: true,
    },
  });

  // If this is a brand new chat, create it immediately
  // so that we have it persisted even if the stream is cancelled or fails.
  if (isNewChat) {
    const initialTitle = getChatTitleFromMessages(messages);

    await upsertChat(
      {
        userId: user.id,
        chatId,
        title: initialTitle,
        messages,
      },
      trace,
    );
  }

  // Filter out tool role messages - convertToModelMessages doesn't support them,
  // and the SDK will reconstruct tool calls from assistant messages automatically
  const messagesWithoutTool = messages.filter(
    (message) => (message.role as string) !== "tool",
  );

  const modelMessages = convertToModelMessages(messagesWithoutTool);

  const result = streamFromDeepSearch({
    messages: modelMessages,
    telemetry: {
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
      await upsertChat(
        {
          userId: user.id,
          chatId,
          title,
          messages: updatedMessages,
        },
        trace,
      );

      // Update trace with output messages
      trace.update({
        output: {
          messages: updatedMessages,
          messageCount: updatedMessages.length,
          title,
        },
      });

      await langfuse.flushAsync();
    },
  });

  return result.toUIMessageStreamResponse();
}

