import type { UIMessage } from "ai";

export const devData: { input: UIMessage[]; expected: string }[] = [
  {
    input: [
      {
        id: "3",
        role: "user",
        parts: [{ type: "text", text: "Between Max Verstappen and Lando Norris, who had the most wins in their respective championship seasons?" }],
      },
    ],
    expected: `Max Verstappen had the most wins in his last championship winning season.`,
  },
  {
    input: [
      {
        id: "4",
        role: "user",
        parts: [{ type: "text", text: "Between Max Verstappen and Lando Norris, who had the most overall fastest laps in their last championship winning season?" }],
      },
    ],
    expected: "Lando Norris had the most overall fastest lap in his last championship winning season.",
  },
];

