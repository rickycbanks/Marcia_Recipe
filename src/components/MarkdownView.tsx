import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

/**
 * Safe Markdown rendering: raw HTML is not enabled at all, and the rendered
 * tree is additionally sanitized (belt & suspenders against injection).
 */
export function MarkdownView({ markdown }: { markdown: string }) {
  if (!markdown.trim()) return null;
  return (
    <div className="prose prose-neutral max-w-none dark:prose-invert prose-headings:font-display">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
