import type { UIMessage } from "ai";

import { convertToModelMessages, streamText, stepCountIs } from "ai";
import { z } from "zod";
import { auth } from "~/server/auth";
import { model } from "~/model";
import { searchSerper } from "~/serper";

export const maxDuration = 60;

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await request.json()) as {
    messages: Array<UIMessage>;
  };

  const { messages } = body;

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
  });

  return result.toUIMessageStreamResponse();
}

