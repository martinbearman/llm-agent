import { evalite } from "evalite";
import { askDeepSearch } from "~/deep-search";

type Message = Parameters<typeof askDeepSearch>[0][number];

evalite("Deep Search Eval", {
  data: async (): Promise<{ input: Message[] }[]> => {
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
      },
      {
        input: [
          {
            id: "2",
            role: "user",
            content:
              "What are the main features of Next.js 14?",
          },
        ],
      },
      {
        input: [
          {
            id: "3",
            role: "user",
            content:
              "What are the best practices for using React Server Components?",
          },
        ],
      },
      {
        input: [
          {
            id: "4",
            role: "user",
            content:
              "How do I implement authentication in Next.js using NextAuth?",
          },
        ],
      },
      {
        input: [
          {
            id: "5",
            role: "user",
            content:
              "What is the difference between Vercel AI SDK and LangChain?",
          },
        ],
      },
      {
        input: [
          {
            id: "6",
            role: "user",
            content:
              "What are the latest updates to the OpenAI API in 2024?",
          },
        ],
      },
      {
        input: [
          {
            id: "7",
            role: "user",
            content:
              "How do I set up a PostgreSQL database with Drizzle ORM?",
          },
        ],
      },
      {
        input: [
          {
            id: "8",
            role: "user",
            content:
              "What are the performance benefits of using Redis for caching?",
          },
        ],
      },
      {
        input: [
          {
            id: "9",
            role: "user",
            content:
              "What is the current status of WebAssembly support in browsers?",
          },
        ],
      },
      {
        input: [
          {
            id: "10",
            role: "user",
            content:
              "How do I implement streaming responses with the Vercel AI SDK?",
          },
        ],
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
  ],
});

