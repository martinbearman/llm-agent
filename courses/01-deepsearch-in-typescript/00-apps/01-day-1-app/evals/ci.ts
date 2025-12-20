import type { UIMessage } from "ai";

export const ciData: { input: UIMessage[]; expected: string }[] = [
  {
    input: [
      {
        id: "1",
        role: "user",
        parts: [{ type: "text", text: "Who is the formula one world champion in 2025?" }],
      },
    ],
    expected:
      "lando Norris",
  },
  {
    input: [
      {
        id: "2",
        role: "user",
        parts: [{ type: "text", text: "Who is the formula one world champion in 2024?" }],
      },
    ],
    expected: "max Verstappen",
  },
];

