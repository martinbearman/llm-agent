import { generateText } from "ai";
import { summarizationModel } from "~/model";
import { cacheWithRedis } from "~/server/redis/redis";

export interface SummarizeURLInput {
  /** The conversation history so far, to give context on what to summarize */
  conversationHistory: string;
  /** The user's question */
  userQuestion: string;
  /** The content scraped from the URL */
  scrapedContent: string;
  /** The URL that was scraped */
  url: string;
  /** The title from the search result */
  title: string;
  /** The snippet from the search result */
  snippet: string;
  /** The date from the search result (if available) */
  date: string;
  /** The query that was used to get the search results */
  query: string;
}

const SUMMARIZATION_PROMPT = `You are a research extraction specialist. Given a research topic and raw web content, create a thoroughly detailed synthesis as a cohesive narrative that flows naturally between key concepts.

Extract the most valuable information related to the research topic, including relevant facts, statistics, methodologies, claims, and contextual information. Preserve technical terminology and domain-specific language from the source material.

Structure your synthesis as a coherent document with natural transitions between ideas. Begin with an introduction that captures the core thesis and purpose of the source material. Develop the narrative by weaving together key findings and their supporting details, ensuring each concept flows logically to the next.

Integrate specific metrics, dates, and quantitative information within their proper context. Explore how concepts interconnect within the source material, highlighting meaningful relationships between ideas. Acknowledge limitations by noting where information related to aspects of the research topic may be missing or incomplete.

Important guidelines:
- Maintain original data context (e.g., "2024 study of 150 patients" rather than generic "recent study")
- Preserve the integrity of information by keeping details anchored to their original context
- Create a cohesive narrative rather than disconnected bullet points or lists
- Use paragraph breaks only when transitioning between major themes

Critical Reminder: If content lacks a specific aspect of the research topic, clearly state that in the synthesis, and you should NEVER make up information and NEVER rely on external knowledge.`;

/**
 * Summarize the content of a URL using an LLM.
 * This function is cached with Redis to avoid redundant API calls.
 */
const summarizeURLUncached = async (
  input: SummarizeURLInput,
  opts?: { langfuseTraceId?: string },
): Promise<string> => {
  const {
    conversationHistory,
    userQuestion,
    scrapedContent,
    url,
    title,
    snippet,
    date,
    query,
  } = input;

  // If there's no content to summarize, return early
  if (!scrapedContent || scrapedContent.trim().length === 0) {
    return "No content available to summarize.";
  }

  const contextBlock = conversationHistory.trim().length > 0
    ? `Previous conversation:\n${conversationHistory}\n\nCurrent user question: ${userQuestion}`
    : `User question: ${userQuestion}`;

  const prompt = `${SUMMARIZATION_PROMPT}

## Research Topic / User Question

${contextBlock}

## Search Query Used

"${query}"

## Source Metadata

- URL: ${url}
- Title: ${title}
- Date: ${date || "Not specified"}
- Snippet: ${snippet}

## Raw Web Content

${scrapedContent}

---

Please synthesize the above content into a detailed summary that directly addresses the research topic. Focus on extracting information most relevant to answering the user's question.`;

  const langfuseTraceId = opts?.langfuseTraceId;

  const result = await generateText({
    model: summarizationModel,
    prompt,
    ...(langfuseTraceId != null && {
      experimental_telemetry: {
        isEnabled: true,
        functionId: "summarize-url",
        metadata: {
          langfuseTraceId,
          url,
        },
      },
    }),
  });

  return result.text;
};

/**
 * Cache key generator for summarization.
 * We use a subset of the input to generate the cache key to avoid
 * overly long keys while still ensuring uniqueness for the same content.
 */
function createSummarizeCacheKey(input: SummarizeURLInput): string {
  // Use URL + query + a hash of the content for the cache key
  // This ensures we don't re-summarize the same content for the same query
  const contentHash = simpleHash(input.scrapedContent);
  return JSON.stringify({
    url: input.url,
    query: input.query,
    userQuestion: input.userQuestion,
    contentHash,
  });
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(16);
}

/**
 * Cached version of summarizeURL that stores results in Redis.
 */
const summarizeURLCached = cacheWithRedis(
  "summarizeURL",
  async (
    cacheKey: string,
    input: SummarizeURLInput,
    langfuseTraceId?: string,
  ): Promise<string> => {
    return summarizeURLUncached(input, { langfuseTraceId });
  },
);

/**
 * Summarize the content of a URL using an LLM.
 * Results are cached in Redis to avoid redundant API calls for the same content.
 *
 * @param input - The input containing the scraped content and metadata
 * @param opts - Optional configuration including langfuseTraceId for telemetry
 * @returns A promise that resolves to the summarized content
 */
export async function summarizeURL(
  input: SummarizeURLInput,
  opts?: { langfuseTraceId?: string },
): Promise<string> {
  const cacheKey = createSummarizeCacheKey(input);
  return summarizeURLCached(cacheKey, input, opts?.langfuseTraceId);
}

/**
 * Summarize multiple URLs in parallel.
 *
 * @param inputs - Array of inputs for each URL to summarize
 * @param opts - Optional configuration including langfuseTraceId for telemetry
 * @returns A promise that resolves to an array of summaries in the same order as inputs
 */
export async function summarizeURLs(
  inputs: SummarizeURLInput[],
  opts?: { langfuseTraceId?: string },
): Promise<string[]> {
  return Promise.all(
    inputs.map((input) => summarizeURL(input, opts)),
  );
}
