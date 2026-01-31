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
        parts: [{ type: "text", text: "Who had the most fastest laps in their last championship-winning seasons, Max Verstappen or Lando Norris" }],
      },
    ],
    expected: "Lando Norris had 6 fastest laps in his last championship winning season in 2025, Max Verstappen had 3 fastest laps championship winning season in 2024. So Lando had more overall fastest laps in his last championship winning season.",
  },
];

