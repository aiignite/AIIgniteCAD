import React, { useState, useEffect, useMemo } from "react";
// @ts-ignore - 'marked' is loaded via importmap in index.html
import { marked } from "marked";

interface MarkdownMessageProps {
  content: string;
  className?: string;
}

const MarkdownMessage: React.FC<MarkdownMessageProps> = ({
  content,
  className = "",
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // 配置 marked 选项
  useEffect(() => {
    marked.setOptions({
      breaks: true,
      gfm: true,
    });
  }, []);

  // 复制功能处理
  const handleCopyCode = (code: string, id: string) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  // 使用 useMemo 解析内容，提高性能并处理代码块
  const tokens = useMemo(() => {
    return marked.lexer(content);
  }, [content]);

  const renderToken = (token: any, index: number) => {
    switch (token.type) {
      case "heading":
        const headingClasses = [
          "text-2xl font-bold mt-4 mb-2",
          "text-xl font-bold mt-3 mb-2",
          "text-lg font-semibold mt-2 mb-1",
          "text-base font-semibold mt-2 mb-1",
          "text-sm font-medium mt-1",
          "text-xs font-medium mt-1",
        ];
        return React.createElement(
          `h${token.depth}`,
          {
            key: index,
            className: `${headingClasses[token.depth - 1] || ""} text-cad-text`,
          },
          token.text,
        );

      case "code":
        const codeId = `code-${index}`;
        return (
          <div key={index} className="relative group my-3">
            <div className="absolute right-2 top-2 z-10 flex items-center gap-2">
              {token.lang && (
                <span className="text-[10px] text-gray-500 font-mono bg-black/20 px-1.5 py-0.5 rounded uppercase">
                  {token.lang}
                </span>
              )}
              <button
                onClick={() => handleCopyCode(token.text, codeId)}
                className="px-2 py-1 text-[10px] bg-gray-700/80 hover:bg-gray-600 text-white rounded border border-gray-600 transition-all flex items-center gap-1 backdrop-blur-sm"
              >
                <span className="material-symbols-outlined text-[12px]">
                  {copiedId === codeId ? "check" : "content_copy"}
                </span>
                {copiedId === codeId ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="bg-gray-900 dark:bg-black/40 rounded-lg overflow-hidden border border-cad-border/30">
              <pre className="p-4 overflow-x-auto">
                <code className="text-sm font-mono text-gray-200 leading-relaxed block">
                  {token.text}
                </code>
              </pre>
            </div>
          </div>
        );

      case "list":
        return (
          <ul
            key={index}
            className={`list-${token.ordered ? "decimal" : "disc"} ml-5 my-2 space-y-1`}
          >
            {token.items.map((item: any, i: number) => (
              <li key={i} className="text-sm text-cad-text leading-relaxed">
                {item.tokens
                  ? item.tokens.map((t: any, ti: number) => renderToken(t, ti))
                  : item.text}
              </li>
            ))}
          </ul>
        );

      case "blockquote":
        return (
          <blockquote
            key={index}
            className="border-l-4 border-cad-primary/50 pl-4 py-1 my-3 italic text-cad-muted bg-cad-primary/5 rounded-r"
          >
            {token.tokens
              ? token.tokens.map((t: any, ti: number) => renderToken(t, ti))
              : token.text}
          </blockquote>
        );

      case "paragraph":
        // 处理行内加粗、斜体、代码等
        return (
          <p
            key={index}
            className="my-2 text-sm leading-relaxed text-cad-text"
            dangerouslySetInnerHTML={{
              __html: marked.parseInline(token.text) as string,
            }}
          />
        );

      case "space":
        return <div key={index} className="h-2" />;

      case "hr":
        return <hr key={index} className="my-4 border-cad-border/50" />;

      case "text":
        // 处理嵌套在其他 token 中的 text
        if (token.tokens) {
          return (
            <span key={index}>
              {token.tokens.map((t: any, ti: number) => renderToken(t, ti))}
            </span>
          );
        }
        return (
          <span
            key={index}
            dangerouslySetInnerHTML={{
              __html: marked.parseInline(token.text) as string,
            }}
          />
        );

      default:
        // 对于不认识的 token 类型，尝试显示其文本
        return (
          <div
            key={index}
            className="text-sm"
            dangerouslySetInnerHTML={{
              __html: marked.parseInline(token.raw || "") as string,
            }}
          />
        );
    }
  };

  return (
    <div className={`markdown-body ${className}`}>
      <style
        dangerouslySetInnerHTML={{
          __html: `
                .markdown-body strong { font-weight: 700; color: inherit; }
                .markdown-body em { font-style: italic; }
                .markdown-body a { color: #137fec; text-decoration: underline; }
                .markdown-body a:hover { opacity: 0.8; }
                .markdown-body code:not(pre code) {
                    padding: 0.1rem 0.3rem;
                    background: rgba(128, 128, 128, 0.15);
                    border-radius: 4px;
                    font-family: monospace;
                    font-size: 0.9em;
                    color: #ef4444;
                }
                .dark .markdown-body code:not(pre code) {
                    background: rgba(255, 255, 255, 0.1);
                    color: #f87171;
                }
            `,
        }}
      />
      {tokens.map((token, index) => renderToken(token, index))}
    </div>
  );
};

export default MarkdownMessage;
