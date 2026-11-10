import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Links in a report open outside Jarvis.
export const Markdown = ({ children }: { children: string }) => (
  <div className="markdown">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{ a: ({ href, children: text }) => <a href={href} target="_blank" rel="noreferrer">{text}</a> }}
    >
      {children}
    </ReactMarkdown>
  </div>
);
