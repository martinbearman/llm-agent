import { smoothStream, streamText, type StreamTextResult } from "ai";
import { model } from "~/model";
import { markdownJoinerTransform } from "~/markdown-joiner-transform";
import type { SystemContext } from "~/system-context";

const LINK_FORMATTING_RULES = `
## Link formatting (mandatory)

Format ALL URLs as footnotes. Do NOT use inline markdown links [text](url) or bare URLs in the body.

Rules:
1. In the main text, reference the link with a footnote marker, e.g. [^1], [^2].
2. At the end of your answer, list each footnote on its own line: [^N]: URL
3. Never embed links in the sentence (no [Google](https://google.com) or raw https://... in prose).

BAD: You should visit [Google](https://www.google.com) for more information.
GOOD: Google is a search engine[^1]. ... [^1]: https://www.google.com

BAD: Check out https://example.com for details.
GOOD: You can find details on their site[^1]. ... [^1]: https://example.com

BAD: See [the docs](https://docs.example.com) for more.
GOOD: See the docs for more[^1]. ... [^1]: https://docs.example.com

BAD: [React](https://react.dev) has great documentation.
GOOD: React has great documentation[^1]. ... [^1]: https://react.dev

BAD: The API is at https://api.example.com
GOOD: The API is documented on their site[^1]. ... [^1]: https://api.example.com

BAD: Download from [releases](https://github.com/org/repo/releases).
GOOD: Download from the releases page[^1]. ... [^1]: https://github.com/org/repo/releases

BAD: [MDN](https://developer.mozilla.org) has references.
GOOD: MDN has references[^1]. ... [^1]: https://developer.mozilla.org

BAD: Read [this article](https://blog.example.com/post).
GOOD: Read this article for context[^1]. ... [^1]: https://blog.example.com/post

BAD: [TypeScript handbook](https://www.typescriptlang.org/docs/) explains this.
GOOD: The TypeScript handbook explains this[^1]. ... [^1]: https://www.typescriptlang.org/docs/

BAD: [Stack Overflow](https://stackoverflow.com) has answers.
GOOD: Stack Overflow has answers[^1]. ... [^1]: https://stackoverflow.com

Always use footnote style for every URL.
`;

function getAnswerSystemPrompt(
  formattedDate: string,
  currentDate: string,
  requestLocationPrompt: string,
  isFinal: boolean,
) {
  const finalNote = isFinal
    ? "\n\nNote: We may not have all the information we need to answer the question (e.g. the step limit was reached). Provide your best effort answer based on the available context. If information is incomplete, say so and cite what you have."
    : "";

  return `You are a helpful AI assistant answering the user's question using the provided search and scrape context.

Current date and time: ${formattedDate} (ISO: ${currentDate})

${requestLocationPrompt}

Your job is to answer the user's question using only the context below (search results and scraped page content). Cite sources using footnotes only (see link formatting rules below). Be comprehensive and accurate based on the context.
${LINK_FORMATTING_RULES}${finalNote}`;
}

export function answerQuestion(
  context: SystemContext,
  opts?: {
    isFinal?: boolean;
    langfuseTraceId?: string;
    onFinish?: (args: { response: { messages: unknown[] } }) => void | Promise<void>;
  },
): StreamTextResult<Record<string, never>, string> {
  const isFinal = opts?.isFinal ?? false;
  const langfuseTraceId = opts?.langfuseTraceId;
  const onFinish = opts?.onFinish;
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
    system: getAnswerSystemPrompt(
      formattedDate,
      currentDate,
      context.getRequestLocationPrompt(),
      isFinal,
    ),
    experimental_transform: [
      markdownJoinerTransform(),
      smoothStream({
        delayInMs: 200,
        chunking: "line",
      }),
    ],
    prompt: `${
      context.getConversationHistory().trim().length > 0
        ? `Previous conversation:\n${context.getConversationHistory()}\n\nCurrent user question: ${context.getUserQuestion()}`
        : `User question: ${context.getUserQuestion()}`
    }

${context.getQueryHistory()}

${context.getScrapeHistory()}

Answer the user's question based on the context above. Cite sources using footnotes only (e.g. [^1] in text and [^1]: URL at the end).`,
    onFinish,
    ...(langfuseTraceId != null && {
      experimental_telemetry: {
        isEnabled: true,
        functionId: "agent-loop-answer-question",
        metadata: {
          langfuseTraceId,
        },
      },
    }),
  });
}
