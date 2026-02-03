export type SearchResult = {
  date: string;
  title: string;
  url: string;
  snippet: string;
  scrapedContent: string;
  /** Summarized content from the URL - used instead of scrapedContent in context */
  summary?: string;
};

export type SearchHistoryEntry = {
  query: string;
  results: SearchResult[];
};

// Legacy types kept for backward compatibility during migration
export type QueryResultSearchResult = {
  date: string;
  title: string;
  url: string;
  snippet: string;
};

export type QueryResult = {
  query: string;
  results: QueryResultSearchResult[];
};

export type ScrapeResult = {
  url: string;
  result: string;
};

export type RequestLocation = {
  latitude?: string;
  longitude?: string;
  city?: string;
  country?: string;
};

export class SystemContext {
  /**
   * The current step in the loop
   */
  private step = 0;

  /**
   * The user's question to answer (the latest message)
   */
  private readonly userQuestion: string;

  /**
   * Formatted prior conversation (user + assistant messages) for context on follow-ups
   */
  private readonly conversationHistory: string;

  /**
   * Hints about the user's request location (derived from IP).
   */
  private readonly requestLocation: RequestLocation;

  /**
   * The history of all searches, including their scraped content
   */
  private searchHistory: SearchHistoryEntry[] = [];

  constructor(
    userQuestion = "",
    conversationHistory = "",
    requestLocation: RequestLocation = {},
  ) {
    this.userQuestion = userQuestion;
    this.conversationHistory = conversationHistory;
    this.requestLocation = requestLocation;
  }

  getStep() {
    return this.step;
  }

  incrementStep() {
    this.step++;
  }

  getUserQuestion(): string {
    return this.userQuestion;
  }

  getConversationHistory(): string {
    return this.conversationHistory;
  }

  getRequestLocationPrompt(): string {
    const normalize = (value?: string) =>
      value && value.trim().length > 0 ? value : "unknown";
    const { latitude, longitude, city, country } = this.requestLocation;

    return `About the origin of the user's request:
- lat: ${normalize(latitude)}
- lon: ${normalize(longitude)}
- city: ${normalize(city)}
- country: ${normalize(country)}`;
  }

  shouldStop() {
    return this.step >= 10;
  }

  reportSearch(search: SearchHistoryEntry) {
    this.searchHistory.push(search);
  }

  getSearchHistory(): string {
    return this.searchHistory
      .map((search) =>
        [
          `## Query: "${search.query}"`,
          ...search.results.map((result) => {
            // Use summary if available, otherwise fall back to scraped content
            const content = result.summary ?? result.scrapedContent;
            const contentTag = result.summary ? "summary" : "scrape_result";
            return [
              `### ${result.date} - ${result.title}`,
              result.url,
              result.snippet,
              `<${contentTag}>`,
              content,
              `</${contentTag}>`,
            ].join("\n\n");
          }),
        ].join("\n\n"),
      )
      .join("\n\n");
  }

  // Legacy methods for backward compatibility - delegate to new methods
  reportQueries(queries: QueryResult[]) {
    // Convert legacy QueryResult to SearchHistoryEntry
    const searchEntries: SearchHistoryEntry[] = queries.map((query) => ({
      query: query.query,
      results: query.results.map((result) => ({
        ...result,
        scrapedContent: "", // Empty scraped content for legacy queries
      })),
    }));
    this.searchHistory.push(...searchEntries);
  }

  reportScrapes(scrapes: ScrapeResult[]) {
    // For legacy scrapes, we need to match them to existing search results
    // This is a best-effort approach - ideally scrapes should be reported with their search query
    scrapes.forEach((scrape) => {
      // Find the most recent search entry and try to match the URL
      for (let i = this.searchHistory.length - 1; i >= 0; i--) {
        const entry = this.searchHistory[i];
        if (entry) {
          const result = entry.results.find((r) => r.url === scrape.url);
          if (result) {
            result.scrapedContent = scrape.result;
            return;
          }
        }
      }
      // If no match found, create a new entry (this shouldn't happen in normal flow)
      this.searchHistory.push({
        query: `Scrape: ${scrape.url}`,
        results: [
          {
            date: "",
            title: "",
            url: scrape.url,
            snippet: "",
            scrapedContent: scrape.result,
          },
        ],
      });
    });
  }

  getQueryHistory(): string {
    return this.getSearchHistory();
  }

  getScrapeHistory(): string {
    return this.getSearchHistory();
  }
}

