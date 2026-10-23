import React, { useState, useMemo } from "react";
import { marked } from "marked";

// marked 选项只需配置一次，放在模块级避免在 effect 中重复设置
marked.setOptions({
  breaks: true,
  gfm: true,
});

interface MarkdownMessageProps {
  content: string;
  className?: string;
}

/** 模型输出可能夹带 HTML（图纸文字、DXF 注释都可能被注入），只允许安全协议 */
const safeHref = (href: unknown): string | null => {
  if (typeof href !== "string" || href.length === 0) return null;
  const trimmed = href.trim();
  if (/^(javascript|data|vbscript|file):/i.test(trimmed)) return null;
  return trimmed;
};

type Token = {
  type: string;
  raw?: string;
  text?: string;
  tokens?: Token[];
  items?: Token[];
  href?: string;
  title?: string;
  depth?: number;
  ordered?: boolean;
  lang?: string;
  [key: string]: unknown;
};

const renderInline = (
  tokens: Token[] | undefined,
  keyPrefix = "",
): React.ReactNode => {
  if (!tokens || tokens.length === 0) return null;

  return tokens.map((token, index) => {
    const key = `${keyPrefix}${index}`;
    const children = () => renderInline(token.tokens, `${key}-`);

    switch (token.type) {
      case "strong":
        return <strong key={key}>{children()}</strong>;
      case "em":
        return <em key={key}>{children()}</em>;
      case "del":
        return <del key={key}>{children()}</del>;
      case "codespan":
        return (
          <code key={key} className="font-mono">
            {token.text}
          </code>
        );
      case "br":
        return <br key={key} />;
      case "link": {
        const href = safeHref(token.href);
        const label = children() ?? token.text;
        return href ? (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-cad-primary underline"
          >
            {label}
          </a>
        ) : (
          <span key={key}>{label}</span>
        );
      }
      // 图片会触发外部请求，聊天里只显示替代文字
      case "image":
        return <span key={key}>{token.text || token.title || "[图片]"}</span>;
      case "html":
        return <span key={key}>{token.text ?? token.raw}</span>;
      case "escape":
        return <span key={key}>{token.text}</span>;
      case "text":
      default:
        return token.tokens && token.tokens.length > 0
          ? <React.Fragment key={key}>{children()}</React.Fragment>
          : <span key={key}>{String(token.text ?? token.raw ?? "")}</span>;
    }
  });
};

const MarkdownMessage: React.FC<MarkdownMessageProps> = ({
  content,
  className = "",
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopyCode = (code: string, id: string) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  // 使用 useMemo 解析内容，提高性能并处理代码块
  const tokens = useMemo(() => marked.lexer(content) as Token[], [content]);

  const renderToken = (token: Token, index: number): React.ReactNode => {
    switch (token.type) {
      case "heading": {
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
            className: `${headingClasses[(token.depth ?? 1) - 1] || ""} text-cad-text`,
          },
          renderInline(token.tokens) ?? token.text,
        );
      }

      case "code": {
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
                onClick={() => handleCopyCode(token.text || "", codeId)}
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
      }

      case "list":
        return (
          <ul
            key={index}
            className={`list-${token.ordered ? "decimal" : "disc"} ml-5 my-2 space-y-1`}
          >
            {(token.items ?? []).map((item, i) => (
              <li key={i} className="text-sm text-cad-text leading-relaxed">
                {(item.tokens ?? []).map((t, ti) => renderToken(t, ti))}
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
            {(token.tokens ?? []).map((t, ti) => renderToken(t, ti))}
          </blockquote>
        );

      case "paragraph":
        return (
          <p key={index} className="my-2 text-sm leading-relaxed text-cad-text">
            {renderInline(token.tokens) ?? token.text}
          </p>
        );

      case "space":
        return <div key={index} className="h-2" />;

      case "hr":
        return <hr key={index} className="my-4 border-cad-border/50" />;

      case "text":
        // 块级 text token 可能带行内子 token，也可能只是裸文本
        return token.tokens && token.tokens.length > 0 ? (
          <span key={index}>{renderInline(token.tokens)}</span>
        ) : (
          <p key={index} className="my-2 text-sm leading-relaxed text-cad-text">
            {token.text ?? token.raw}
          </p>
        );

      default:
        // 不认识的 token 类型按纯文本显示，绝不把原始 HTML 注入 DOM
        return (
          <div key={index} className="text-sm text-cad-text whitespace-pre-wrap">
            {token.raw ?? token.text ?? ""}
          </div>
        );
    }
  };

  return (
    <div className={`markdown-body ${className}`}>
      <style>{`
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
      `}</style>
      {tokens.map((token, index) => renderToken(token, index))}
    </div>
  );
};

export default MarkdownMessage;
