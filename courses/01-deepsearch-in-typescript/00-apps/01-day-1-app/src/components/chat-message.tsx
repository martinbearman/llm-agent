import type { UIMessage } from "ai";
import ReactMarkdown, { type Components } from "react-markdown";

export type MessagePart = NonNullable<UIMessage["parts"]>[number];

interface ChatMessageProps {
  message: UIMessage;
  userName: string;
}

const components: Components = {
  // Override default elements with custom styling
  p: ({ children }) => <p className="mb-4 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-4 list-disc pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="mb-4 list-decimal pl-4">{children}</ol>,
  li: ({ children }) => <li className="mb-1">{children}</li>,
  code: ({ className, children, ...props }) => (
    <code className={`${className ?? ""}`} {...props}>
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="mb-4 overflow-x-auto rounded-lg bg-gray-700 p-4">
      {children}
    </pre>
  ),
  a: ({ children, ...props }) => (
    <a
      className="text-blue-400 underline"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
};

const Markdown = ({ children }: { children: string }) => {
  return <ReactMarkdown components={components}>{children}</ReactMarkdown>;
};

const ToolInvocation = ({ part }: { part: MessagePart }) => {
  // Handle different possible structures - log to see what we actually get
  console.log("ToolInvocation - part:", part);
  
  // Try to extract tool information from the part
  const toolName = "toolName" in part ? part.toolName : part.type.replace("tool-", "");
  const state = "state" in part ? part.state : "unknown";
  const args = "args" in part ? part.args : ("input" in part ? part.input : {});
  const toolCallId = "toolCallId" in part ? part.toolCallId : "";
  const hasResult = ("output" in part && part.output !== undefined) || ("result" in part && part.result !== undefined);
  const result = "result" in part ? part.result : ("output" in part ? part.output : undefined);

  // Heuristically detect PDF / HTML sources for the scrapePages tool
  let hasPdfSource = false;
  let hasHtmlSource = false;

  if (toolName === "scrapePages" && hasResult && result && typeof result === "object") {
    const typedResult = result as {
      success?: boolean;
      results?: { url: string; result: { success: boolean; sourceType?: "html" | "pdf" } }[];
    };

    const items = typedResult.results ?? [];
    for (const item of items) {
      const sourceType = item.result && "sourceType" in item.result ? item.result.sourceType : undefined;
      if (sourceType === "pdf") {
        hasPdfSource = true;
      }
      if (sourceType === "html") {
        hasHtmlSource = true;
      }
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-gray-700 bg-gray-700/50 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-semibold text-blue-400">Tool Call</span>
        <span className="text-xs text-gray-400">({state})</span>

        {toolName === "scrapePages" && (
          <div className="ml-auto flex items-center gap-1">
            {hasPdfSource && (
              <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-300">
                PDF
              </span>
            )}
            {hasHtmlSource && (
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300">
                Web
              </span>
            )}
          </div>
        )}
      </div>
      <div className="mb-2">
        <span className="text-sm font-medium text-gray-300">Tool:</span>
        <span className="ml-2 text-sm text-gray-400">{toolName}</span>
      </div>
      <div className="mb-2">
        <span className="text-sm font-medium text-gray-300">Arguments:</span>
        <pre className="mt-1 overflow-x-auto rounded bg-gray-800 p-2 text-xs">
          {JSON.stringify(args, null, 2)}
        </pre>
      </div>
      {hasResult && result !== undefined && (
        <div>
          <span className="text-sm font-medium text-gray-300">Result:</span>
          <pre className="mt-1 overflow-x-auto rounded bg-gray-800 p-2 text-xs">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};

export const ChatMessage = ({ message, userName }: ChatMessageProps) => {
  const isAI = message.role === "assistant";
  const parts = message.parts ?? [];

  return (
    <div className="mb-6">
      <div
        className={`rounded-lg p-4 ${
          isAI ? "bg-gray-800 text-gray-300" : "bg-gray-900 text-gray-300"
        }`}
      >
        <p className="mb-2 text-sm font-semibold text-gray-400">
          {isAI ? "AI" : userName}
        </p>

        <div className="prose prose-invert max-w-none">
          {parts.map((part: MessagePart, index: number) => {
            console.log(`ChatMessage - Part ${index}:`, part);
            console.log(`ChatMessage - Part ${index} type:`, part.type);
            if (part.type === "text") {
              return <Markdown key={index}>{part.text}</Markdown>;
            }
            // Check if it's a tool part (could be "tool-invocation" or "tool-{toolName}")
            if (typeof part.type === "string" && part.type.startsWith("tool-")) {
              const toolCallId = "toolCallId" in part ? part.toolCallId : `tool-${index}`;
              return (
                <ToolInvocation
                  key={toolCallId}
                  part={part}
                />
              );
            }
            return null;
          })}
        </div>
      </div>
    </div>
  );
};
