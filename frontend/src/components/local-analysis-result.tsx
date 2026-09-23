"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { BlockMath, InlineMath } from "react-katex";

import styles from "@/app/local-reader.module.css";
import type { AnalysisBlock, AnalysisResult, AnalysisSource } from "@/types/local-analysis";

import { MathText } from "./math-text";

export function LocalSource({ source, paperId }: { source: AnalysisSource; paperId: string }) {
  return (
    <details className={styles.source}>
      <summary>
        <span>{source.inferred ? "解读 / 推断" : "原文明确陈述"}</span>
        <span>{source.pages.length ? `PDF 第 ${source.pages.join("、")} 页` : "未定位页码"}</span>
        <span>查看依据</span>
      </summary>
      <div className={styles.sourceBody}>
        <p><MathText>{source.evidence || "未提供原文依据，请回到论文核对。"}</MathText></p>
        <div className={styles.sourceLinks}>
          {source.pages.map((page) => (
            <a key={page} href={`/api/local/papers/${encodeURIComponent(paperId)}/pdf#page=${page}`} target="_blank" rel="noreferrer">
              在论文中查看第 {page} 页<span className="visually-hidden">（在新标签页打开）</span>
            </a>
          ))}
        </div>
      </div>
    </details>
  );
}

function Blocks({ blocks, paperId }: { blocks: AnalysisBlock[]; paperId: string }) {
  return blocks.map((block, index) => (
    <div className={styles.block} key={index}>
      {block.kind === "formula" ? (
        <div className={styles.formula} role="group" aria-label="数学公式" tabIndex={0}>
          <BlockMath math={block.text} renderError={() => <code>{block.text}</code>} />
        </div>
      ) : <p><MathText>{block.text}</MathText></p>}
      <LocalSource source={block.source} paperId={paperId} />
    </div>
  ));
}

const tabs = [
  { id: "overview", label: "概览" },
  { id: "proof", label: "证明" },
  { id: "relations", label: "关系" },
  { id: "importance", label: "为什么重要" },
] as const;

export function LocalAnalysisResult({ result, paperId }: { result: AnalysisResult; paperId: string }) {
  const [active, setActive] = useState<(typeof tabs)[number]["id"]>("overview");
  const id = useId();

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    setActive(tabs[next].id);
    document.getElementById(`${id}-tab-${tabs[next].id}`)?.focus();
  }

  return (
    <article className={styles.reading} aria-label={`${result.title}的解读`}>
      <h2>{result.title}</h2>
      <p className={styles.readingNotice}>AI 生成的阅读辅助，不代替原文。请核对公式、前提和出处；“解读 / 推断”不代表论文原话。</p>
      {!result.target_found && <p className={styles.warning} role="alert">未找到你指定的结论。请核对编号、名称或粘贴结论的开头，再重新分析；不会用其他结论替代。</p>}
      {result.limitations.length > 0 && (
        <aside className={styles.limitations} aria-label="本次分析的限制">
          <strong>阅读前请注意</strong>
          <ul>{result.limitations.map((item, index) => <li key={index}><MathText>{item}</MathText></li>)}</ul>
        </aside>
      )}
      <div className={styles.tabs} role="tablist" aria-label="结论解读">
        {tabs.map((tab, index) => (
          <button key={tab.id} id={`${id}-tab-${tab.id}`} type="button" role="tab" aria-selected={active === tab.id}
            aria-controls={`${id}-panel-${tab.id}`} tabIndex={active === tab.id ? 0 : -1}
            onClick={() => setActive(tab.id)} onKeyDown={(event) => moveTab(event, index)}>{tab.label}</button>
        ))}
      </div>
      <div id={`${id}-panel-${active}`} role="tabpanel" aria-labelledby={`${id}-tab-${active}`} tabIndex={0} className={styles.readingBody}>
        {active === "overview" && <>
          <section aria-labelledby={`${id}-statement`}>
            <h3 id={`${id}-statement`}>结论陈述</h3>
            {result.statement.length ? <Blocks blocks={result.statement} paperId={paperId} /> : <p className={styles.muted}>没有可核对的结论陈述。</p>}
          </section>
          <section aria-labelledby={`${id}-symbols`}>
            <h3 id={`${id}-symbols`}>公式中的符号</h3>
            {result.symbols.length ? <dl className={styles.symbols}>
              {result.symbols.map((symbol, index) => <div key={index}>
                <dt><InlineMath math={symbol.symbol} renderError={() => <code>{symbol.symbol}</code>} /><span><MathText>{symbol.meaning}</MathText></span></dt>
                <dd><p><MathText>{symbol.explanation}</MathText></p><LocalSource source={symbol.source} paperId={paperId} /></dd>
              </div>)}
            </dl> : <p className={styles.muted}>本次结果未提取到符号定义。</p>}
          </section>
          <section><h3>直观理解</h3><Blocks blocks={result.intuitive_explanation} paperId={paperId} /></section>
          <section><h3>证明思路</h3><Blocks blocks={result.proof.strategy} paperId={paperId} /></section>
        </>}
        {active === "proof" && <>
          <section><h3>要证明什么</h3><Blocks blocks={result.proof.goal} paperId={paperId} /></section>
          <section><h3>关键思路</h3><Blocks blocks={result.proof.strategy} paperId={paperId} /></section>
          {result.proof.sections.map((section, index) => <section key={index}><h3><MathText>{section.title}</MathText></h3><Blocks blocks={section.blocks} paperId={paperId} /></section>)}
          {!result.proof.sections.length && <p className={styles.muted}>本次结果没有可展开的证明解读。请查看分析限制并核对原文。</p>}
        </>}
        {active === "relations" && (result.relations.length ? result.relations.map((relation, index) => (
          <section key={index} className={styles.relation}>
            <h3><MathText>{relation.target}</MathText></h3>
            <h4>这个结论说了什么</h4>
            {relation.statement.length ? <Blocks blocks={relation.statement} paperId={paperId} /> : <p className={styles.muted}>未取得可核对的陈述，请查看原文。</p>}
            <h4>与当前结论的关系</h4>
            <Blocks blocks={relation.explanation} paperId={paperId} />
          </section>
        )) : <p className={styles.muted}>本次分析没有确认其他结论之间的关系。</p>)}
        {active === "importance" && (result.importance.length ? result.importance.map((section, index) => (
          <section key={index}><h3><MathText>{section.title}</MathText></h3><Blocks blocks={section.blocks} paperId={paperId} /></section>
        )) : <p className={styles.muted}>本次分析没有提供重要性解读。</p>)}
      </div>
    </article>
  );
}
