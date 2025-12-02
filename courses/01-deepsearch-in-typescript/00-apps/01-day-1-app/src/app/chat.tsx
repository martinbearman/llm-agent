 "use client";

import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChatMessage } from "~/components/chat-message";
import { SignInModal } from "~/components/sign-in-modal";

interface ChatProps {
  userName: string;
  isAuthenticated: boolean;
  // We intentionally type this as `unknown` here to avoid coupling the client
  // component to the server-side `UIMessage` type while still allowing
  // `useChat` to hydrate from the initial state.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialMessages: any[];
  existingChatId?: string;
}

export const ChatPage = ({
  userName,
  isAuthenticated,
  initialMessages,
  existingChatId,
}: ChatProps) => {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [showSignInModal, setShowSignInModal] = useState(false);
  const [hasRedirected, setHasRedirected] = useState(false);

  const [localChatId] = useState(() => crypto.randomUUID());
  const effectiveChatId = existingChatId ?? localChatId;
  const isExistingChat = Boolean(existingChatId);

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
    // `initialMessages` is passed via the transport's initial config so that
    // the client can render server-fetched messages on first load.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    messages: initialMessages,
    id: effectiveChatId,
    onError: (error) => {
      const errorMessage =
        error instanceof Error
          ? error.message.toLowerCase()
          : String(error).toLowerCase();

      // Show sign-in modal if we get a 401 Unauthorized error
      if (errorMessage.includes("401") || errorMessage.includes("unauthorized")) {
        setShowSignInModal(true);
        return;
      }

      // Show toast if we get a 429 Too Many Requests error
      if (errorMessage.includes("429") || errorMessage.includes("too many requests")) {
        toast.error("Rate limit exceeded", {
          description: "You've reached your daily request limit. Please try again tomorrow.",
        });
      }
    },
    onFinish: () => {
      // For brand new chats (no chatId from the URL), redirect to `/?id=...`
      // after the first assistant response so the sidebar and server state
      // stay in sync.
      if (!isExistingChat && !hasRedirected) {
        setHasRedirected(true);
        router.push(`/?id=${effectiveChatId}`);
      }
    },
  });

  const isLoading = status === "streaming" || status === "submitted";

  useEffect(() => {
    console.log("ChatPage - All messages:", messages);
    messages.forEach((message, index) => {
      console.log(`ChatPage - Message ${index}:`, message);
      console.log(`ChatPage - Message ${index} parts:`, message.parts);
    });
  }, [messages]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    if (!isAuthenticated) {
      setShowSignInModal(true);
      return;
    }

    sendMessage({
      role: "user",
      parts: [{ type: "text", text: input }],
    });
    setInput("");
  };

  return (
    <>
      <div className="flex flex-1 flex-col">
        <div
          className="mx-auto w-full max-w-[65ch] flex-1 overflow-y-auto p-4 scrollbar-thin scrollbar-track-gray-800 scrollbar-thumb-gray-600 hover:scrollbar-thumb-gray-500"
          role="log"
          aria-label="Chat messages"
        >
          {!isExistingChat && isLoading && !hasRedirected && (
            <div className="mb-3 text-center text-xs text-gray-500">
              Creating a new chat&hellip;
            </div>
          )}
          {messages.map((message) => {
            return (
              <ChatMessage
                key={message.id}
                message={message}
                userName={userName}
              />
            );
          })}
          {isLoading && (
            <div className="mb-6 flex items-center gap-2 rounded-lg bg-gray-800 p-4 text-gray-400">
              <Loader2 className="size-5 animate-spin" />
              <span>AI is thinking...</span>
            </div>
          )}
        </div>

        <div className="border-t border-gray-700">
          <form
            onSubmit={handleSubmit}
            className="mx-auto max-w-[65ch] p-4"
          >
            <div className="flex gap-2">
              <input
                value={input}
                onChange={handleInputChange}
                placeholder="Say something..."
                autoFocus
                aria-label="Chat input"
                className="flex-1 rounded border border-gray-700 bg-gray-800 p-2 text-gray-200 placeholder-gray-400 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={isLoading}
                className="rounded bg-gray-700 px-4 py-2 text-white hover:bg-gray-600 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 disabled:hover:bg-gray-700"
              >
                {isLoading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Send"
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      <SignInModal
        isOpen={showSignInModal}
        onClose={() => setShowSignInModal(false)}
      />
    </>
  );
};
