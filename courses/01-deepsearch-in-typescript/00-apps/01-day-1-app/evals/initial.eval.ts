import { createScorer, evalite } from "evalite";
import { generateObject } from "ai";
import { z } from "zod";
import { askDeepSearch } from "~/deep-search";
import { factualityModel } from "~/model";

type Message = Parameters<typeof askDeepSearch>[0][number];

const checkFactuality = async (opts: {
  question: string;
  groundTruth: string;
  submission: string;
}) => {
  const { object } = await generateObject({
    model: factualityModel,
    /**
     * Prompt taken from autoevals:
     *
     * {@link https://github.com/braintrustdata/autoevals/blob/5aa20a0a9eb8fc9e07e9e5722ebf71c68d082f32/templates/factuality.yaml}
     */
    prompt: `
      You are comparing a submitted answer to an expert answer on a given question. Here is the data:

      [BEGIN DATA]

      ************

      [Question]: ${opts.question}

      ************

      [Expert]: ${opts.groundTruth}

      ************

      [Submission]: ${opts.submission}

      ************

      [END DATA]

      Compare the factual content of the submitted answer with the expert answer. Ignore any differences in style, grammar, or punctuation.

      The submitted answer may either be a subset or superset of the expert answer, or it may conflict with it. Determine which case applies. Answer the question by selecting one of the following options:

      (A) The submitted answer is a subset of the expert answer and is fully consistent with it.

      (B) The submitted answer is a superset of the expert answer and is fully consistent with it.

      (C) The submitted answer contains all the same details as the expert answer.

      (D) There is a disagreement between the submitted answer and the expert answer.

      (E) The answers differ, but these differences don't matter from the perspective of factuality.

    `,
    schema: z.object({
      answer: z
        .enum(["A", "B", "C", "D", "E"])
        .describe("Your selection."),
      rationale: z
        .string()
        .describe(
          "Why you chose this answer. Be very detailed.",
        ),
    }),
  });

  /**
   * LLM's are well documented at being poor at generating scores.
   */
  const scores = {
    A: 0.4,
    B: 0.6,
    C: 1,
    D: 0,
    E: 1,
  };

  return {
    score: scores[object.answer],
    metadata: {
      rationale: object.rationale,
    },
  };
};

// This is the scorer that can be passed into the scorers in Evalite
const Factuality = createScorer<
  Message[],
  string,
  string
>({
  name: "Factuality",
  scorer: async ({ input, expected, output }) => {
    // Extract the question from the messages array
    const question = input
      .filter((msg) => msg.role === "user")
      .map((msg) => msg.content)
      .join(" ");

    return checkFactuality({
      question,
      groundTruth: expected!,
      submission: output,
    });
  },
});

evalite("Deep Search Eval", {
  data: async (): Promise<
    { input: Message[]; expected: string }[]
  > => {
    return [
      {
        input: [
          {
            id: "1",
            role: "user",
            content:
              "What is the latest version of TypeScript?",
          },
        ],
        expected:
          "The current TypeScript version is 5.9",
      },
      {
        input: [
          {
            id: "2",
            role: "user",
            content:
              "What are the main features of Next.js 15?",
          },
        ],
        expected: `
@next/codemod CLI: Easily upgrade to the latest Next.js and React versions.

Async Request APIs (Breaking): Incremental step towards a simplified rendering and caching model.

Caching Semantics (Breaking): fetch requests, GET Route Handlers, and client navigations are no longer cached by default.

React 19 Support: Support for React 19, React Compiler (Experimental), and hydration error improvements.

Turbopack Dev (Stable): Performance and stability improvements.

Static Indicator: New visual indicator shows static routes during development.

unstable_after API (Experimental): Execute code after a response finishes streaming.

instrumentation.js API (Stable): New API for server lifecycle observability.

Enhanced Forms (next/form): Enhance HTML forms with client-side navigation.

next.config: TypeScript support for next.config.ts.

Self-hosting Improvements: More control over Cache-Control headers.

Server Actions Security: Unguessable endpoints and removal of unused actions.

Bundling External Packages (Stable): New config options for App and Pages Router.

ESLint 9 Support: Added support for ESLint 9.

Development and Build Performance: Improved build times and Faster Fast Refresh.
`,
      },
    ];
  },
  task: async (input) => {
    return askDeepSearch(input);
  },
  scorers: [
    {
      name: "Contains Links",
      description:
        "Checks if the output contains any markdown links.",
      scorer: ({ output }) => {
        // Check for markdown link syntax: [text](url)
        const markdownLinkPattern = /\[([^\]]+)\]\(([^)]+)\)/;
        const containsLinks = markdownLinkPattern.test(output);

        return containsLinks ? 1 : 0;
      },
    },
    Factuality,
  ],
});

