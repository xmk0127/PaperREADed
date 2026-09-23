"use client";

import { type KeyboardEvent, useState } from "react";
import Link from "next/link";
import { BlockMath, InlineMath } from "react-katex";

import { readerTabs as tabs, type TabId } from "@/lib/reader-tabs";
import { formatSourcePages } from "@/lib/presentation";
import type { PropositionData } from "@/types/proposition";

import { HealthStatus } from "./health-status";
import { ImportanceReading } from "./importance-reading";
import { MathText } from "./math-text";
import { ProofArticle } from "./proof-article";
import { RelationsReading } from "./relations-reading";
import { EvidenceBadge, PaperPdfAvailabilityContext, SourceMeta } from "./source-meta";

function originalWording(value: string) {
  return value.replace(/\s*\.\.\.\s*\(20\)\.$/, "");
}

function EvidenceQuote({ children }: { children: string }) {
  return (
    <blockquote className="evidence-quote">
      <span>论文原文依据</span>
      <p><MathText>{children}</MathText></p>
    </blockquote>
  );
}

function OverviewPanel({ data }: { data: PropositionData }) {
  const { statement, intuitive_explanation: explanation, proof } = data;

  return (
    <div className="tab-content overview-reading">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">阅读结论</p>
          <h2>命题陈述与符号说明</h2>
        </div>
      </div>

      <article className="statement-card">
        <div className="statement-card__topline">
          <div>
            <span>命题原文</span>
            <h3>{statement.label}</h3>
          </div>
          <span className="equation-pill">{statement.equation_number}</span>
        </div>
        <p className="original-wording">{originalWording(statement.evidence)}</p>
        <div className="statement-card__formula">
          <BlockMath math={statement.formula} />
        </div>
        <SourceMeta sourcePage={statement.source_page} inferred={statement.inferred} />
      </article>

      <SymbolsSection data={data} />

      <div className="overview-grid">
        <article className="overview-card overview-card--accent">
          <p className="panel-kicker">一句话解释</p>
          <p className="overview-card__lead"><MathText>{explanation.text}</MathText></p>
          <SourceMeta
            sourcePage={explanation.source_page}
            inferred={explanation.inferred}
            compact
          />
        </article>
        <article className="overview-card">
          <p className="panel-kicker">证明策略</p>
          <p><MathText>{proof.strategy.text}</MathText></p>
          <SourceMeta
            sourcePage={proof.strategy.source_page}
            inferred={proof.strategy.inferred}
            compact
          />
        </article>
      </div>
    </div>
  );
}

function SymbolsSection({ data }: { data: PropositionData }) {
  return (
    <section className="overview-symbols" id="overview-symbols" aria-labelledby="overview-symbols-title">
      <header className="overview-symbols__heading">
        <h2 id="overview-symbols-title">公式中的符号</h2>
        <span>{data.symbols.length} 个符号与相关定义</span>
      </header>

      <dl className="symbol-list">
        {data.symbols.map((symbol) => (
          <div className="symbol-row" key={symbol.symbol}>
            <dt>
              <span className="symbol-row__math"><InlineMath math={symbol.symbol} /></span>
              <span className="symbol-row__meaning"><MathText>{symbol.meaning}</MathText></span>
            </dt>
            <dd className="symbol-row__content">
              <p><MathText>{symbol.explanation}</MathText></p>
              <div className="symbol-row__meta">
                <EvidenceBadge inferred={symbol.inferred} />
                <span>{formatSourcePages(symbol.source_page)}</span>
              </div>
              <details className="symbol-evidence">
                <summary>原文依据与出处</summary>
                <EvidenceQuote>{symbol.evidence}</EvidenceQuote>
                <SourceMeta sourcePage={symbol.source_page} inferred={symbol.inferred} compact />
              </details>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ActivePanel({ tab, data }: { tab: TabId; data: PropositionData }) {
  switch (tab) {
    case "proof":
      return <ProofArticle data={data} />;
    case "relations":
      return <RelationsReading data={data} />;
    case "importance":
      return <ImportanceReading data={data} />;
    default:
      return <OverviewPanel data={data} />;
  }
}

export function PaperReader({ data, initialTab = "overview", paperPdfAvailable = true }: {
  data: PropositionData;
  initialTab?: TabId;
  paperPdfAvailable?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);

  function selectTab(tab: TabId) {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState(window.history.state, "", url);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const forwards = event.key === "ArrowRight" || event.key === "ArrowDown";
    const backwards = event.key === "ArrowLeft" || event.key === "ArrowUp";
    if (!forwards && !backwards && event.key !== "Home" && event.key !== "End") return;

    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (index + (forwards ? 1 : -1) + tabs.length) % tabs.length;
    const nextTab = tabs[nextIndex];
    selectTab(nextTab.id);
    document.getElementById(`tab-${nextTab.id}`)?.focus();
  }

  return (
    <PaperPdfAvailabilityContext.Provider value={paperPdfAvailable}>
    <div className="reader-shell">
      <header className="reader-header">
        <div className="reader-brand">
          <span className="reader-brand__mark" aria-hidden="true">∴</span>
          <Link className="reader-brand__name" href="/" title="返回论文库">PaperREADed</Link>
        </div>
        <div className="paper-identity">
          <strong title="Wall crossing for symplectic vortices and quantum cohomology">
            辛涡旋与量子上同调的跨墙现象
          </strong>
          <span>基准条目 · {data.statement.label}</span>
        </div>
        <div className="reader-header__status">
          <HealthStatus />
        </div>
      </header>

      <main className="reader-workspace">
        <section className="analysis-pane" aria-label={`${data.statement.label} 阅读分析`}>
          <aside className="result-rail" aria-label="当前命题摘要">
            <div className="proposition-header">
              <div className="proposition-header__meta">
                <span>当前结论</span>
                <span>
                  PDF 第 {data.statement.source_page.pdf.join(", ")} 页 · 论文第{" "}
                  {data.statement.source_page.printed.join(", ")} 页
                </span>
              </div>
              <h1>{data.statement.label}</h1>
              <p className="proposition-statement"><MathText>{data.statement.text}</MathText></p>
            </div>

            <div className="tabs" role="tablist" aria-label="命题分析选项">
              {tabs.map((tab, index) => (
                <button
                  id={`tab-${tab.id}`}
                  className={activeTab === tab.id ? "tab tab--active" : "tab"}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  aria-controls="analysis-panel"
                  tabIndex={activeTab === tab.id ? 0 : -1}
                  key={tab.id}
                  onClick={() => selectTab(tab.id)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                >
                  <span>{tab.label}</span>
                  <span className="tab__arrow" aria-hidden="true">→</span>
                </button>
              ))}
            </div>
          </aside>

          <div
            key={activeTab}
            id="analysis-panel"
            className="analysis-panel"
            role="tabpanel"
            aria-labelledby={`tab-${activeTab}`}
          >
            <ActivePanel tab={activeTab} data={data} />
          </div>
        </section>
      </main>
    </div>
    </PaperPdfAvailabilityContext.Provider>
  );
}
