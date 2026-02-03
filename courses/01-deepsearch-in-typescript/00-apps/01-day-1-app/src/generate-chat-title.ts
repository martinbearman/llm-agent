import type { UIMessage } from "ai";
import { generateText } from "ai";
import { model } from "~/model";

function getTextFromMessage(message: UIMessage): string {
  const textPart = message.parts?.find(
    (part) => part.type === "text" && "text" in part,
  ) as { type: "text"; text: string } | undefined;
  return textPart?.text.trim() ?? "";
}

export async function generateChatTitle(messages: UIMessage[]): Promise<string> {
  const chatHistoryText = messages
    .map((m) => `${m.role}: ${getTextFromMessage(m)}`)
    .filter(Boolean)
    .join("\n\n");

  if (!chatHistoryText.trim()) {
    return "";
  }

  const { text } = await generateText({
    model,
    system: `You are a chat title generator.
You will be given a chat history, and you will need to generate a title for the chat.
The title should be a single sentence that captures the essence of the chat.
The title should be no more than 50 characters.
The title should be in the same language as the chat history.`,
    prompt: `Here is the chat history:

${chatHistoryText}`,
  });

  return text.trim();
}
