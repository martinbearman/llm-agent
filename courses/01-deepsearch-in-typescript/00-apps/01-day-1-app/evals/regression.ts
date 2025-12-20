import type { UIMessage } from "ai";

export const regressionData: { input: UIMessage[]; expected: string }[] = [
  {
    input: [
      {
        id: "4",
        role: "user",
        parts: [{ type: "text", text: "Between Max Verstappen and Lando Norris, who had the most overall fastest lap in their last championship winning season?" }],
      },
    ],
    expected: "Lando Norris had the most overall fastest lap in his last championship winning season.",
  },
];

