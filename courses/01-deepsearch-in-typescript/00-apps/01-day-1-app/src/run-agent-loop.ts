import type { StreamTextResult } from "ai";
import { env } from "~/env";
import { searchSerper } from "~/serper";
import { crawlMultipleUrls } from "~/server/scraper";
import {
  type RequestLocation,
  type SearchHistoryEntry,
  type SearchResult,
  SystemContext,
} from "~/system-context";
import {
  getNextAction,
  type Action,
  type OurMessageAnnotation,
} from "~/deep-search";
import { answerQuestion } from "~/answer-question";
import { summarizeURLs, type SummarizeURLInput } from "~/summarize-url";

/**
 * Search the web and automatically scrape the URLs from the search results.
 * This combines the previous search and scrape actions into a single deterministic action.
 */
async function searchWeb(
  context: SystemContext,
  query: string,
  opts?: { langfuseTraceId?: string },
): Promise<void> {
  // Step 1: Search the web
  const results = await searchSerper(
    { q: query, num: env.SEARCH_RESULTS_COUNT },
    undefined,
  );

  // Extract URLs from search results
  const urls = results.organic.map((result) => result.link);

  // Step 2: Automatically scrape all URLs from the search results
  let scrapedResults: Array<{ url: string; content: string }> = [];
  
  try {
    const crawlResult = await crawlMultipleUrls(urls);
    scrapedResults = crawlResult.results.map(({ url, result }) => ({
      url,
      content:
        result.success === true
          ? result.data
          : (result as { success: false; error: string }).error,
    }));
  } catch (error) {
    // If scraping fails, create error entries for all URLs
    scrapedResults = urls.map((url) => ({
      url,
      content:
        error instanceof Error ? error.message : "Unknown error occurred",
    }));
  }

  // Step 3: Summarize all scraped content in parallel
  const summarizeInputs: SummarizeURLInput[] = results.organic.map((result) => {
    const scraped = scrapedResults.find((s) => s.url === result.link);
    return {
      conversationHistory: context.getConversationHistory(),
      userQuestion: context.getUserQuestion(),
      scrapedContent: scraped?.content ?? "",
      url: result.link,
      title: result.title,
      snippet: result.snippet,
      date: result.date ?? "",
      query,
    };
  });

  const summaries = await summarizeURLs(summarizeInputs, {
    langfuseTraceId: opts?.langfuseTraceId,
  });

  // Step 4: Combine search results with scraped content and summaries
  const searchResults: SearchResult[] = results.organic.map((result, index) => {
    const scraped = scrapedResults.find((s) => s.url === result.link);
    return {
      title: result.title,
      url: result.link,
      snippet: result.snippet,
      date: result.date ?? "",
      scrapedContent: scraped?.content ?? "",
      summary: summaries[index],
    };
  });

  // Step 5: Report the combined search entry
  const searchEntry: SearchHistoryEntry = {
    query,
    results: searchResults,
  };
  context.reportSearch(searchEntry);
}

/**
 * Run the agent loop: repeatedly get next action, execute it, and either
 * return an answer or continue until the step limit, then return a best-effort answer.
 */
export async function runAgentLoop(
  userQuestion: string,
  opts?: {
    conversationHistory?: string;
    requestLocation?: RequestLocation;
    langfuseTraceId?: string;
    onFinish?: (args: { response: { messages: unknown[] } }) => void | Promise<void>;
    writeMessageAnnotation?: (annotation: OurMessageAnnotation) => void;
  },
): Promise<StreamTextResult<Record<string, never>, string>> {
  const ctx = new SystemContext(
    userQuestion,
    opts?.conversationHistory ?? "",
    opts?.requestLocation ?? {},
  );
  const langfuseTraceId = opts?.langfuseTraceId;
  const onFinish = opts?.onFinish;
  const writeMessageAnnotation = opts?.writeMessageAnnotation;

  while (!ctx.shouldStop()) {
    const nextAction: Action = await getNextAction(ctx, { langfuseTraceId });

    writeMessageAnnotation?.({
      type: "NEW_ACTION",
      action: nextAction,
    } satisfies OurMessageAnnotation);

    if (nextAction.type === "search") {
      await searchWeb(ctx, nextAction.query, { langfuseTraceId });
    } else if (nextAction.type === "answer") {
      return answerQuestion(ctx, { langfuseTraceId, onFinish });
    }

    ctx.incrementStep();
  }

  return answerQuestion(ctx, { isFinal: true, langfuseTraceId, onFinish });
}
