import { Copy } from "lucide-react";
import { Children, ComponentPropsWithoutRef, ReactNode, isValidElement } from "react";

type MarkdownPreProps = ComponentPropsWithoutRef<"pre"> & {
  onCopyCode: (text: string) => void;
};

export function MarkdownTable({ children, ...props }: ComponentPropsWithoutRef<"table">) {
  return (
    <div className="markdown-table-scroll">
      <table {...props}>{children}</table>
    </div>
  );
}

export function MarkdownPre({ children, onCopyCode, ...props }: MarkdownPreProps) {
  const codeText = extractReactNodeText(children);
  const language = readCodeLanguage(children);

  return (
    <div className="codeblock">
      <div className="codeblock-header">
        <span>{language}</span>
        <button type="button" data-tooltip="Copy code" aria-label="Copy code" onClick={() => onCopyCode(codeText)}>
          <Copy size={12} />
        </button>
      </div>
      <pre {...props}>{children}</pre>
    </div>
  );
}

function readCodeLanguage(node: ReactNode): string {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ className?: unknown }>(child)) {
      continue;
    }

    const className = child.props.className;
    if (typeof className !== "string") {
      continue;
    }

    const match = /language-([A-Za-z0-9_-]+)/.exec(className);
    if (match?.[1]) {
      return match[1];
    }
  }

  return "text";
}

function extractReactNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractReactNodeText).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return extractReactNodeText(node.props.children);
  }
  return "";
}
