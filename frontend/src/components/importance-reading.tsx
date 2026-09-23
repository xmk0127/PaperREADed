import { BlockMath, InlineMath } from "react-katex";

import type { ImportanceFormula, PropositionData, SourcedText } from "@/types/proposition";
import { formatSourcePages } from "@/lib/presentation";
import { MathText } from "./math-text";
import { EvidenceBadge, SourceMeta } from "./source-meta";
import styles from "./importance-reading.module.css";

function Source({ item }: { item: SourcedText }) {
  return <details className={styles.source}>
    <summary><EvidenceBadge inferred={item.inferred} /><span>{formatSourcePages(item.source_page)}</span><span>原文依据</span></summary>
    <blockquote><MathText>{item.evidence}</MathText></blockquote>
    <SourceMeta sourcePage={item.source_page} inferred={item.inferred} compact />
  </details>;
}

function MathFormula({ latex, label }: { latex: string; label: string }) {
  return <div className={styles.formula} role="group" aria-label={label} tabIndex={0}>
    <BlockMath math={latex} />
  </div>;
}

function FormulaExplanation({ item }: { item: ImportanceFormula }) {
  return <>
    <MathFormula latex={item.latex} label={item.label} />
    <p><MathText>{item.text}</MathText></p>
    <Source item={item} />
  </>;
}

export function ImportanceReading({ data }: { data: PropositionData }) {
  const { lead, comparison, geometry, calculation, limits } = data.importance_reading;
  const residue = data.related_statements.main_consequence.blocks.filter((block) => block.type === "formula")[1];

  return <article className={`tab-content ${styles.article}`} aria-labelledby="importance-reading-title">
    <header className={styles.header}>
      <h2 id="importance-reading-title">这个结论在论文中的作用</h2>
      <p className={styles.lead}><MathText>{lead.text}</MathText></p>
      <Source item={lead} />
    </header>

    <section aria-labelledby="importance-reduction">
      <h3 id="importance-reduction">{comparison.title}</h3>
      <div className={styles.notation}>
        <span>{comparison.notation.label}</span>
        <MathFormula latex={comparison.notation.latex} label={comparison.notation.label} />
        <p><MathText>{comparison.notation.text}</MathText></p>
        <Source item={comparison.notation} />
      </div>
      <div className={styles.comparison} aria-label="归约前后的数学任务对照">
        {[comparison.before, comparison.after].map((item, index) => <div key={item.label} className={index ? styles.result : styles.start}>
          <h4>{item.label}</h4>
          <FormulaExplanation item={item} />
        </div>)}
      </div>
    </section>

    <section aria-labelledby="importance-boundary">
      <h3 id="importance-boundary">{geometry.title}</h3>
      <p><MathText>{geometry.introduction.text}</MathText></p>
      <Source item={geometry.introduction} />
      <figure className={styles.geometry} aria-label="切除奇异点集前后的边界示意">
        <div className={styles.geometryPanels}>
          {geometry.panels.map((panel, index) => <div className={styles.geometryPanel} key={panel.title}>
            <h4>{panel.title} <InlineMath math={panel.space} /></h4>
            <div className={styles.drawing}>
              <svg viewBox="0 0 360 200" preserveAspectRatio="none" aria-hidden="true">
                <path d="M 22 25 H 338 V 175 H 22 Z" className={styles.region} />
                <path d="M 22 25 H 338 M 22 175 H 338" className={styles.ends} />
                {index === 0
                  ? <ellipse cx="180" cy="100" rx="68" ry="30" className={styles.singular} />
                  : <ellipse cx="180" cy="100" rx="90" ry="42" className={styles.cut} />}
              </svg>
              <span className={styles.top}><InlineMath math={panel.top} /></span>
              <span className={styles.middle}><InlineMath math={panel.center} /><small>{panel.center_label}</small></span>
              <span className={styles.bottom}><InlineMath math={panel.bottom} /></span>
            </div>
            <p>{panel.caption}</p>
          </div>)}
        </div>
        <figcaption><MathText>{geometry.caution.text}</MathText></figcaption>
        <Source item={geometry.caution} />
      </figure>
      <h4>{geometry.condition.label}</h4>
      <FormulaExplanation item={geometry.condition} />
      <div className={styles.identity}>
        <h4>{geometry.identity.label}</h4>
        <FormulaExplanation item={geometry.identity} />
      </div>
    </section>

    <section aria-labelledby="importance-calculation">
      <h3 id="importance-calculation">{calculation.title}</h3>
      <p><MathText>{calculation.introduction.text}</MathText></p>
      <Source item={calculation.introduction} />
      <div className={styles.calculation} role="list" aria-label="四个结论各自完成的计算">
        {calculation.rows.map((item) => <div role="listitem" className={styles.calculationRow} key={item.label}>
          <h4>{item.label}</h4>
          <div><FormulaExplanation item={item} /></div>
        </div>)}
      </div>
      {residue && <details className={styles.residue}>
        <summary>展开 α₀ 的具体公式</summary>
        <MathFormula latex={residue.latex} label={residue.label} />
        <SourceMeta sourcePage={data.related_statements.main_consequence.source_page} inferred={false} compact />
      </details>}
      <p className={styles.conclusion}><MathText>{calculation.conclusion.text}</MathText></p>
      <Source item={calculation.conclusion} />
    </section>

    <aside className={styles.limits} aria-label="作用的边界">
      <h3>不要从这个命题多推出一步</h3>
      <p><MathText>{limits.text}</MathText></p>
      <Source item={limits} />
    </aside>
  </article>;
}
