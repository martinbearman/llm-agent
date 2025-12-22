import {
  streamText,
  stepCountIs,
  type TelemetrySettings,
  type UIMessage,
  convertToModelMessages,
} from "ai";
import { z } from "zod";
import { env } from "~/env";
import { model } from "~/model";
import { searchSerper } from "~/serper";
import { crawlMultipleUrls } from "~/server/scraper";

const getSystemPrompt = (formattedDate: string, currentDate: string) => {
  return `You are a helpful AI assistant with access to web search and web scraping capabilities.

Current date and time: ${formattedDate} (ISO: ${currentDate})

CRITICAL REQUIREMENT: Every response you generate MUST include at least one markdown link in the format [source text](url). This is mandatory and non-negotiable. Even if scraping fails, you must cite sources from searchWeb results using markdown links.

When answering questions, you must:
- Always use the searchWeb tool to find current and accurate information
- Always use the scrapePages tool on a diverse set of high-signal URLs (for example, the top ${env.SCRAPE_URLS_COUNT} results from searchWeb), ideally from different domains, to retrieve the full page content in markdown before composing your final answer
- When selecting URLs for scrapePages, prefer diversity of sources (e.g. news sites, blogs, documentation, reference sites) rather than multiple pages from the same domain, unless the topic is highly specialized
- If there are many relevant results, choose ${env.SCRAPE_URLS_COUNT} URLs to scrape in a single scrapePages call; if fewer are available, scrape all that are clearly relevant
- Cite your sources with inline links using markdown format: [source text](url)
- Provide comprehensive answers based on both the search results and the scraped page content
- If the user asks about current events, recent information, or anything that requires up-to-date data, you must use the searchWeb tool and then use scrapePages on at least one relevant result, preferably ${env.SCRAPE_URLS_COUNT} diverse URLs when available
- When users ask for up-to-date information, pay attention to the publication dates of search results and prioritize more recent sources. Use the current date (${formattedDate}) to determine how recent information is and inform users about the recency of the information you're providing
- Respect that scrapePages may return errors when a site cannot be crawled (for example due to robots.txt); in that case, explain this limitation to the user and fall back to other available information, but ALWAYS include markdown links to the searchWeb results
- Before finishing your response, verify that you have included at least one markdown link. If you haven't, add links to relevant sources from the searchWeb results using the format [source text](url)`
};

type ModelMessage = ReturnType<typeof convertToModelMessages>[number];

export const streamFromDeepSearch = (opts: {
  messages: ModelMessage[];
  onFinish: Parameters<typeof streamText>[0]["onFinish"];
  telemetry: TelemetrySettings;
}) => {
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

  return streamText({
    model,
    messages: opts.messages,
    // Reduced from 15 to 8 to limit costs - each step can involve multiple model calls
    // (tool selection, result processing, next action). 8 steps is typically sufficient
    // for: searchWeb (1) -> scrapePages (1) -> final response (1) with some retries/refinements
    stopWhen: stepCountIs(8),
    system: getSystemPrompt(formattedDate, currentDate),
    tools: {
      searchWeb: {
        inputSchema: z.object({
          query: z.string().describe("The query to search the web for. The results will include URLs that you MUST cite in your final response using markdown links."),
        }),
        execute: async ({ query }, { abortSignal }) => {
          const results = await searchSerper(
            { q: query, num: env.SEARCH_RESULTS_COUNT },
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
    onFinish: opts.onFinish,
    experimental_telemetry: opts.telemetry,
  });
};

export async function askDeepSearch(messages: UIMessage[]) {
  // Filter out tool role messages - convertToModelMessages doesn't support them,
  // and the SDK will reconstruct tool calls from assistant messages automatically
  const messagesWithoutTool = messages.filter(
    (message) => (message.role as string) !== "tool",
  );

  const modelMessages = convertToModelMessages(messagesWithoutTool);

  const result = streamFromDeepSearch({
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

