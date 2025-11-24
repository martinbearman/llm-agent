import type { UIMessage } from "ai";

import { convertToModelMessages, streamText } from "ai";
import { model } from "~/model";

export const maxDuration = 60;

export async function POST(request: Request) {
  const body = (await request.json()) as {
    messages: Array<UIMessage>;
  };

  const { messages } = body;

  const modelMessages = convertToModelMessages(messages);

  const result = streamText({
    model,
    messages: modelMessages,
  });

  return result.toUIMessageStreamResponse();
}

