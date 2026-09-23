"use client";

import { useState } from "react";
import { BlockMath } from "react-katex";

import type { ProofStep, PropositionData, SourcePage } from "@/types/proposition";

import { MathText } from "./math-text";
import { EvidenceBadge, SourceMeta } from "./source-meta";
import styles from "./proof-article.module.css";

type EvidenceProps = {
  source_page: SourcePage;
  evidence: string;
  inferred: boolean;
};

type ProofFormula = ProofStep["formulas"][number];

function ArticleEvidence({ source_page, evidence, inferred }: EvidenceProps) {
  return (
    <details className={`proof-article__evidence ${styles.evidence}`}>
      <summary>
        <EvidenceBadge inferred={inferred} />
        <span>核对原文 · PDF 第 {source_page.pdf.join("、")} 页</span>
      </summary>
      <p><MathText>{evidence}</MathText></p>
      <SourceMeta sourcePage={source_page} inferred={inferred} compact />
    </details>
  );
}

function Formula({ formula, id }: { formula: ProofFormula; id: string }) {
  return (
    <figure className={styles.formula} id={id} aria-labelledby={`${id}-label`}>
      <figcaption id={`${id}-label`}><MathText>{formula.label}</MathText></figcaption>
      <div className={styles.math} tabIndex={0} aria-label={`${formula.label}，数学公式`}>
        <BlockMath math={formula.latex} />
      </div>
      <ArticleEvidence {...formula} />
    </figure>
  );
}

function FullNarrative({ data, formulas }: { data: PropositionData; formulas: Map<string, ProofFormula> }) {
  const { narrative } = data.proof;
  const [expanded, setExpanded] = useState(false);

  return (
    <details className={styles.fullNarrative} onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>展开完整解释与技术细节</summary>
      {expanded ? <div className={styles.fullNarrativeBody}>
        <p><MathText>{narrative.introduction.text}</MathText></p>
        <ArticleEvidence {...narrative.introduction} />
        {narrative.sections.map((section) => (
          <section id={`proof-full-${section.id}`} key={section.id}>
            <h3>{section.title}</h3>
            {section.blocks.map((block, index) => {
              if (block.type === "paragraph") {
                return <p key={index}><MathText>{block.text}</MathText></p>;
              }
              const formula = formulas.get(block.formula_id);
              if (!formula) throw new Error("Missing proof formula: " + block.formula_id);
              return <Formula formula={formula} id={`formula-full-${section.id}-${index}-${formula.id}`} key={index} />;
            })}
            <ArticleEvidence {...section} />
          </section>
        ))}
      </div> : null}
    </details>
  );
}

export function ProofArticle({ data }: { data: PropositionData }) {
  const { logic, logic_formulas, steps } = data.proof;
  const formulas = new Map(
    [...steps.flatMap((step) => step.formulas), ...logic_formulas].map((formula) => [formula.id, formula]),
  );
  const displayedFormulaIds = new Set<string>();

  function renderFormula(formulaId: string, context: string) {
    const formula = formulas.get(formulaId);
    if (!formula) throw new Error("Missing proof formula: " + formulaId);
    const id = displayedFormulaIds.has(formulaId) ? `formula-${context}-${formulaId}` : `formula-${formulaId}`;
    displayedFormulaIds.add(formulaId);
    return <Formula formula={formula} id={id} key={`${context}-${formulaId}`} />;
  }

  return (
    <article className={`tab-content ${styles.article}`} aria-labelledby="proof-article-title">
      <header className={styles.header}>
        <p className={styles.kicker}>命题 4.1 · 证明</p>
        <h2 id="proof-article-title">{logic.title}</h2>
        <p className={styles.notation}><MathText>{logic.notation}</MathText></p>
        <div className={styles.goal}>{renderFormula(logic.goal_formula_id, "goal")}</div>
      </header>

      <section className={styles.backbone} aria-labelledby="proof-backbone-title">
        <h3 id="proof-backbone-title">证明主线</h3>
        <div className={styles.backboneRows}>
          {logic.backbone.map((item, index) => (
            <div className={styles.backboneRow} key={item.formula_id}>
              <h4>{item.label}</h4>
              <div>
                {renderFormula(item.formula_id, `backbone-${index}`)}
                <p className={styles.backboneReason}><MathText>{item.reason}</MathText></p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.setup} aria-labelledby="proof-setup-title">
        <h3 id="proof-setup-title">{logic.setup.title}</h3>
        {logic.setup.formula_ids.map((id) => renderFormula(id, "setup"))}
        <p><MathText>{logic.setup.context}</MathText></p>
        <ArticleEvidence {...logic.setup} />
      </section>

      <div className={styles.arguments}>
        {logic.arguments.map((argument, index) => (
          <section className={styles.argument} id={`proof-logic-${argument.id}`} aria-labelledby={`proof-logic-${argument.id}-title`} key={argument.id}>
            <h3 id={`proof-logic-${argument.id}-title`}>
              <span className={styles.number} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              {argument.title}
            </h3>
            <div className={styles.argumentFormulas}>
              {argument.formula_ids.map((id) => renderFormula(id, argument.id))}
            </div>
            <dl className={styles.reasoning}>
              <div>
                <dt>使用条件</dt>
                <dd><ul>{argument.uses.map((condition, conditionIndex) => <li key={conditionIndex}><MathText>{condition}</MathText></li>)}</ul></dd>
              </div>
              <div>
                <dt>关键推理</dt>
                <dd><MathText>{argument.reason}</MathText></dd>
              </div>
              <div className={styles.result}>
                <dt>得到</dt>
                <dd><MathText>{argument.result}</MathText></dd>
              </div>
            </dl>
            <ArticleEvidence {...argument} />
          </section>
        ))}
      </div>

      <section className={styles.conclusion} aria-labelledby="proof-conclusion-title">
        <h3 id="proof-conclusion-title">合并两个等式，证明完成</h3>
        <p><MathText>{logic.conclusion.text}</MathText></p>
        <ArticleEvidence {...logic.conclusion} />
      </section>

      <FullNarrative data={data} formulas={formulas} />
    </article>
  );
}
