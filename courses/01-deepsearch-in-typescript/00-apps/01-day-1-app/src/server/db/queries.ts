import { and, count, eq, gte, lt } from "drizzle-orm";

import { env } from "~/env";
import { db } from "~/server/db";
import { requestLogs, users } from "~/server/db/schema";

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

