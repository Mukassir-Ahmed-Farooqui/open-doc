import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Citation } from "@/lib/api/schemas";
import { CITE_HREF_PREFIX, linkifyCitations } from "@/lib/citations";
import { CitationChip } from "./CitationChip";

export interface MarkdownProps {
  content: string;
  citations?: Map<string, Citation>;
  onCite?: (sourceId: string) => void;
  activeCite?: string | null;
}

/** Markdown renderer. When `citations` is given, [S#] markers render as interactive chips. */
export const Markdown = memo(function Markdown({ content, citations, onCite, activeCite }: MarkdownProps) {
  const withCites = citations !== undefined;
  const components: Components = {
    a({ href, children, ...props }) {
      if (withCites && href?.startsWith(CITE_HREF_PREFIX)) {
        const id = href.slice(CITE_HREF_PREFIX.length);
        return <CitationChip id={id} citation={citations.get(id)} onClick={onCite} active={activeCite === id} />;
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
          {children}
        </a>
      );
    },
  };
  return (
    <div className="prose-doc">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {withCites ? linkifyCitations(content) : content}
      </ReactMarkdown>
    </div>
  );
});
