import { streamText, type StreamTextResult } from "ai";
import { model } from "~/model";
import type { SystemContext } from "~/system-context";

function getAnswerSystemPrompt(
  formattedDate: string,
  currentDate: string,
  isFinal: boolean,
) {
  const finalNote = isFinal
    ? "\n\nNote: We may not have all the information we need to answer the question (e.g. the step limit was reached). Provide your best effort answer based on the available context. If information is incomplete, say so and cite what you have."
    : "";

  return `You are a helpful AI assistant answering the user's question using the provided search and scrape context.

Current date and time: ${formattedDate} (ISO: ${currentDate})

Your job is to answer the user's question using only the context below (search results and scraped page content). Cite your sources with inline markdown links in the format [source text](url). Include at least one markdown link. Be comprehensive and accurate based on the context.${finalNote}`;
}

export function answerQuestion(
  context: SystemContext,
  opts?: { isFinal?: boolean },
): StreamTextResult<Record<string, never>, string> {
  const isFinal = opts?.isFinal ?? false;
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
    system: getAnswerSystemPrompt(formattedDate, currentDate, isFinal),
    prompt: `User question: ${context.getUserQuestion()}

${context.getQueryHistory()}

${context.getScrapeHistory()}

Answer the user's question based on the context above. Use markdown links to cite sources.`,
  });
}
