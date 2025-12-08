import { setTimeout } from "node:timers/promises";
import { redis } from "~/server/redis/redis";

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  keyPrefix?: string;
  maxRetries?: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  totalHits: number;
  retry: () => Promise<boolean>;
}

const DEFAULT_KEY_PREFIX = "rate_limit";
const DEFAULT_MAX_RETRIES = 3;

const getWindowKey = ({
  windowMs,
  keyPrefix,
}: {
  windowMs: number;
  keyPrefix: string;
}): { key: string; windowStart: number } => {
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const key = `${keyPrefix}:${windowStart}`;
  return { key, windowStart };
};

export const recordRateLimit = async ({
  windowMs,
  keyPrefix = DEFAULT_KEY_PREFIX,
}: Pick<RateLimitConfig, "windowMs" | "keyPrefix">): Promise<void> => {
  const { key, windowStart } = getWindowKey({
    windowMs,
    keyPrefix,
  });

  try {
    const pipeline = redis.pipeline();
    pipeline.incr(key);
    pipeline.expire(key, Math.ceil(windowMs / 1000));

    const results = await pipeline.exec();

    if (!results) {
      throw new Error("Redis pipeline execution failed");
    }

    const [incrError] = results[0] ?? [];
    if (incrError) {
      throw incrError;
    }
  } catch (error) {
    console.error(
      "Rate limit recording failed:",
      error,
      `key=${key}`,
      `windowStart=${windowStart}`,
    );
    throw error;
  }
};

export const checkRateLimit = async ({
  maxRequests,
  windowMs,
  keyPrefix = DEFAULT_KEY_PREFIX,
  maxRetries = DEFAULT_MAX_RETRIES,
}: RateLimitConfig): Promise<RateLimitResult> => {
  const { key, windowStart } = getWindowKey({
    windowMs,
    keyPrefix,
  });

  try {
    const currentCount = await redis.get(key);
    const count = currentCount ? parseInt(currentCount, 10) : 0;

    const allowed = count < maxRequests;
    const remaining = Math.max(0, maxRequests - count);
    const resetTime = windowStart + windowMs;

    let retryCount = 0;

    const retry = async (): Promise<boolean> => {
      if (!allowed) {
        const waitTime = resetTime - Date.now();
        if (waitTime > 0) {
          await setTimeout(waitTime);
        }

        const retryResult = await checkRateLimit({
          maxRequests,
          windowMs,
          keyPrefix,
          maxRetries,
        });

        if (!retryResult.allowed) {
          if (retryCount >= maxRetries) {
            return false;
          }
          retryCount += 1;
          return retryResult.retry();
        }
        return true;
      }
      return true;
    };

    return {
      allowed,
      remaining,
      resetTime,
      totalHits: count,
      retry,
    };
  } catch (error) {
    console.error(
      "Rate limit check failed:",
      error,
      `key=${key}`,
      `windowStart=${windowStart}`,
    );
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetTime: windowStart + windowMs,
      totalHits: 0,
      retry: async () => true,
    };
  }
};

