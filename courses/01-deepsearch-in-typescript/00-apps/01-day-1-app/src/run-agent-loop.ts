import { env } from "~/env";
import { searchSerper } from "~/serper";
import { crawlMultipleUrls } from "~/server/scraper";
import {
  type QueryResult,
  type QueryResultSearchResult,
  type ScrapeResult,
  SystemContext,
} from "~/system-context";
import { getNextAction, type Action } from "~/deep-search";
import { answerQuestion } from "~/answer-question";

/**
 * Search the web and report results into the context.
 * Logic copied from deep-search.ts searchWeb tool execute.
 */
async function searchWeb(
  context: SystemContext,
  query: string,
): Promise<void> {
  const results = await searchSerper(
    { q: query, num: env.SEARCH_RESULTS_COUNT },
    undefined,
  );

  const queryResults: QueryResultSearchResult[] = results.organic.map(
    (result) => ({
      title: result.title,
      url: result.link,
      snippet: result.snippet,
      date: result.date ?? "",
    }),
  );

  const queryResult: QueryResult = {
    query,
    results: queryResults,
  };
  context.reportQueries([queryResult]);
}

/**
 * Scrape the given URLs and report results into the context.
 * Logic copied from deep-search.ts scrapePages tool execute.
 */
async function scrapeUrl(
  context: SystemContext,
  urls: string[],
): Promise<void> {
  try {
    const crawlResult = await crawlMultipleUrls(urls);

    const scrapes: ScrapeResult[] = crawlResult.results.map(
      ({ url, result }) => ({
        url,
        result:
          result.success === true
            ? result.data
            : (result as { success: false; error: string }).error,
      }),
    );
    context.reportScrapes(scrapes);
  } catch (error) {
    const scrapes: ScrapeResult[] = urls.map((url) => ({
      url,
      result:
        error instanceof Error ? error.message : "Unknown error occurred",
    }));
    context.reportScrapes(scrapes);
  }
}

/**
 * Run the agent loop: repeatedly get next action, execute it, and either
 * return an answer or continue until the step limit, then return a best-effort answer.
 */
export async function runAgentLoop(userQuestion: string): Promise<string> {
  const ctx = new SystemContext(userQuestion);

  while (!ctx.shouldStop()) {
    const nextAction: Action = await getNextAction(ctx);

    if (nextAction.type === "search") {
      await searchWeb(ctx, nextAction.query);
    } else if (nextAction.type === "scrape") {
      await scrapeUrl(ctx, nextAction.urls);
    } else if (nextAction.type === "answer") {
      return answerQuestion(ctx);
    }

    ctx.incrementStep();
  }

  return answerQuestion(ctx, { isFinal: true });
}
