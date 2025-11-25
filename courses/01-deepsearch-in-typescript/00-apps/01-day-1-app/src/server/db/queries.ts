import type { UIMessage } from "ai";
import { and, count, desc, eq, gte, lt } from "drizzle-orm";

import { env } from "~/env";
import { db } from "~/server/db";
import { chats, messages, requestLogs, users } from "~/server/db/schema";

const dailyRequestLimit = env.REQUESTS_PER_DAY_LIMIT;

const getDayBounds = (date: Date) => {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
};

export async function getUserById(userId: string) {
  return db.query.users.findFirst({
    where: eq(users.id, userId),
  });
}

export async function getDailyRequestCount(userId: string, date = new Date()) {
  const { start, end } = getDayBounds(date);

  const [result] = await db
    .select({ value: count() })
    .from(requestLogs)
    .where(
      and(
        eq(requestLogs.userId, userId),
        gte(requestLogs.createdAt, start),
        lt(requestLogs.createdAt, end),
      ),
    );

  return result?.value ?? 0;
}

export function getRequestLimitPerDay() {
  return dailyRequestLimit;
}

export async function insertRequestLog(userId: string) {
  await db.insert(requestLogs).values({ userId });
}

export const upsertChat = async (opts: {
  userId: string;
  chatId: string;
  title: string;
  messages: UIMessage[];
}) => {
  const { userId, chatId, title, messages: messageList } = opts;

  // Check if chat exists (regardless of user)
  const existingChat = await db.query.chats.findFirst({
    where: eq(chats.id, chatId),
  });

  if (existingChat) {
    // If chat exists but belongs to a different user, throw an error
    if (existingChat.userId !== userId) {
      throw new Error(
        `Chat with id ${chatId} already exists and belongs to a different user`,
      );
    }

    // Chat exists and belongs to user - delete all existing messages
    await db.delete(messages).where(eq(messages.chatId, chatId));

    // Update chat title and updatedAt
    await db
      .update(chats)
      .set({
        title,
        updatedAt: new Date(),
      })
      .where(eq(chats.id, chatId));
  } else {
    // Create new chat
    await db.insert(chats).values({
      id: chatId,
      userId,
      title,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // Insert all messages
  if (messageList.length > 0) {
    await db.insert(messages).values(
      messageList.map((message, index) => ({
        id: message.id ?? crypto.randomUUID(),
        chatId,
        role: message.role,
        parts: message.parts,
        order: index,
      })),
    );
  }
};

export async function getChat(chatId: string, userId: string) {
  const chat = await db.query.chats.findFirst({
    where: and(eq(chats.id, chatId), eq(chats.userId, userId)),
    with: {
      messages: {
        orderBy: [messages.order],
      },
    },
  });

  if (!chat) {
    return null;
  }

  // Convert database messages to AI SDK Message format
  const formattedMessages: UIMessage[] = chat.messages.map((msg) => ({
    id: msg.id,
    role: msg.role as UIMessage["role"],
    parts: msg.parts as UIMessage["parts"],
  }));

  return {
    ...chat,
    messages: formattedMessages,
  };
}

export async function getChats(userId: string) {
  return db.query.chats.findMany({
    where: eq(chats.userId, userId),
    orderBy: [desc(chats.updatedAt)],
  });
}

