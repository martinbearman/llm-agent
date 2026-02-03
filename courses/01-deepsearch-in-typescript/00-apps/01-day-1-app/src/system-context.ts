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

const toQueryResult = (
  query: QueryResultSearchResult,
) =>
  [
    `### ${query.date} - ${query.title}`,
    query.url,
    query.snippet,
  ].join("\n\n");

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
   * The history of all queries searched
   */
  private queryHistory: QueryResult[] = [];

  /**
   * The history of all URLs scraped
   */
  private scrapeHistory: ScrapeResult[] = [];

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

  reportQueries(queries: QueryResult[]) {
    this.queryHistory.push(...queries);
  }

  reportScrapes(scrapes: ScrapeResult[]) {
    this.scrapeHistory.push(...scrapes);
  }

  getQueryHistory(): string {
    return this.queryHistory
      .map((query) =>
        [
          `## Query: "${query.query}"`,
          ...query.results.map(toQueryResult),
        ].join("\n\n"),
      )
      .join("\n\n");
  }

  getScrapeHistory(): string {
    return this.scrapeHistory
      .map((scrape) =>
        [
          `## Scrape: "${scrape.url}"`,
          `<scrape_result>`,
          scrape.result,
          `</scrape_result>`,
        ].join("\n\n"),
      )
      .join("\n\n");
  }
}

