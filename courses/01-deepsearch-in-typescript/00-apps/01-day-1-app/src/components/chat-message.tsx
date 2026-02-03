import type { UIMessage } from "ai";
import { Search as SearchIcon } from "lucide-react";
import { useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { OurMessageAnnotation } from "~/deep-search";

export type MessagePart = NonNullable<UIMessage["parts"]>[number];

const ReasoningSteps = ({
  annotations,
}: {
  annotations: OurMessageAnnotation[];
}) => {
  const [openStep, setOpenStep] = useState<number | null>(null);

  if (annotations.length === 0) return null;

  return (
    <div className="mb-4 w-full">
      <ul className="space-y-1">
        {annotations.map((annotation, index) => {
          const isOpen = openStep === index;
          return (
            <li key={index} className="relative">
              <button
                onClick={() => setOpenStep(isOpen ? null : index)}
                className={`min-w-34 flex w-full flex-shrink-0 items-center rounded px-2 py-1 text-left text-sm transition-colors ${
                  isOpen
                    ? "bg-gray-700 text-gray-200"
                    : "text-gray-400 hover:bg-gray-800 hover:text-gray-300"
                }`}
              >
                <span
                  className={`z-10 mr-3 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 border-gray-500 text-xs font-bold ${
                    isOpen
                      ? "border-blue-400 text-white"
                      : "bg-gray-800 text-gray-300"
                  }`}
                >
                  {index + 1}
                </span>
                {annotation.action.title}
              </button>
              <div className={`${isOpen ? "mt-1" : "hidden"}`}>
                {isOpen && (
                  <div className="px-2 py-1">
                    <div className="text-sm italic text-gray-400">
                      <Markdown>{annotation.action.reasoning}</Markdown>
                    </div>
                    {annotation.action.type === "search" && (
                      <div className="mt-2 flex items-center gap-2 text-sm text-gray-400">
                        <SearchIcon className="size-4" />
                        <span>{annotation.action.query}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

interface ChatMessageProps {
  message: UIMessage & { annotations?: OurMessageAnnotation[] };
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
  a: ({ href, children, ...props }) => {
    const isExternal = href?.startsWith("http");
    return (
      <a
        className="text-blue-400 underline"
        {...(isExternal && {
          target: "_blank",
          rel: "noopener noreferrer",
        })}
        href={href}
        {...props}
      >
        {children}
      </a>
    );
  },
  sup: ({ children, ...props }) => (
    <sup className="ml-0.5 font-medium text-blue-400" {...props}>
      {children}
    </sup>
  ),
};

const Markdown = ({ children }: { children: string }) => {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  );
};

const ToolInvocation = ({ part }: { part: MessagePart }) => {
  // Handle different possible structures and surface a consistent summary
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

type NewActionPart = {
  type: "data-NEW_ACTION";
  data: { action: OurMessageAnnotation["action"] };
};

function getReasoningAnnotations(parts: MessagePart[]): OurMessageAnnotation[] {
  return parts
    .filter((p): p is NewActionPart => {
      if (p.type !== "data-NEW_ACTION" || !("data" in p)) return false;
      const data = p.data;
      return (
        typeof data === "object" &&
        data !== null &&
        "action" in data &&
        data.action != null
      );
    })
    .map((p) => ({ type: "NEW_ACTION" as const, action: p.data.action }));
}

export const ChatMessage = ({ message, userName }: ChatMessageProps) => {
  const isAI = message.role === "assistant";
  const parts = message.parts ?? [];
  const reasoningAnnotations: OurMessageAnnotation[] = isAI
    ? (Array.isArray(message.annotations) && message.annotations.length > 0
        ? message.annotations
        : getReasoningAnnotations(parts))
    : [];

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

        {isAI && reasoningAnnotations.length > 0 && (
          <ReasoningSteps annotations={reasoningAnnotations} />
        )}

        <div className="prose prose-invert max-w-none">
          {parts.map((part: MessagePart, index: number) => {
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
