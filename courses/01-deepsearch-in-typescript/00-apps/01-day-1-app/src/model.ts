import { google } from "@ai-sdk/google";

export const model = google("gemini-2.0-flash-001");

export const factualityModel = google("gemini-2.0-flash-lite");

/**
 * Model for summarizing URLs - optimized for speed with a large context window.
 * Uses gemini-2.0-flash-lite which is fast and cost-effective for summarization tasks.
 */
export const summarizationModel = google("gemini-2.0-flash-lite");
