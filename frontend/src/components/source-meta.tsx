"use client";

import { createContext, useContext } from "react";
import { formatSourcePages } from "@/lib/presentation";
import type { SourcePage } from "@/types/proposition";

type SourceMetaProps = {
  sourcePage: SourcePage;
  inferred: boolean;
  compact?: boolean;
};

const PAPER_PDF_PATH = "/papers/wall-crossing-symplectic-vortices.pdf";

// The server page checks the local asset once for the entire example reader.
export const PaperPdfAvailabilityContext = createContext(true);

export function EvidenceBadge({ inferred }: { inferred: boolean }) {
  return (
    <span className={inferred ? "evidence-badge evidence-badge--inferred" : "evidence-badge"}>
      {inferred ? "推断" : "原文明示"}
    </span>
  );
}

export function SourceMeta({ sourcePage, inferred, compact = false }: SourceMetaProps) {
  const paperPdfAvailable = useContext(PaperPdfAvailabilityContext);
  const pdfPages = sourcePage.pdf.filter((page, index, pages) => pages.indexOf(page) === index);

  return (
    <div className={compact ? "source-meta source-meta--compact" : "source-meta"}>
      <EvidenceBadge inferred={inferred} />
      <span className="source-meta__pages">{formatSourcePages(sourcePage)}</span>
      {pdfPages.length > 0 && !paperPdfAvailable ? (
        <span className="source-meta__pages">本机未附带示例 PDF；可继续阅读解读并按上述页码核对原文。</span>
      ) : null}
      {pdfPages.length > 0 && paperPdfAvailable ? (
        <div className="source-meta__actions">
          {pdfPages.map((page) => (
            <a
              className="view-in-paper"
              href={`${PAPER_PDF_PATH}#page=${page}&zoom=page-fit`}
              target="_blank"
              rel="noreferrer"
              aria-label={`在论文中查看，PDF 第 ${page} 页（在新标签页打开）`}
              key={page}
            >
              在论文中查看 · PDF 第 {page} 页
              <span aria-hidden="true">↗</span>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
