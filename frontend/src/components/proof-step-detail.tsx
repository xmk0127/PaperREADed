"use client";

import { BlockMath } from "react-katex";

import type { ProofStep } from "@/types/proposition";

import { MathText } from "./math-text";
import { EvidenceBadge, SourceMeta } from "./source-meta";

type ProofStepDetailProps = {
  step: ProofStep;
  steps: ProofStep[];
  onSelect: (id: string) => void;
};

export function ProofStepDetail({ step, steps, onSelect }: ProofStepDetailProps) {
  const { analysis } = step;
  const dependencies = steps.filter((previous) => step.depends_on.includes(previous.id));

  return (
    <article id="proof-step-detail" className="proof-reading-detail nodrag nopan">
      <div className="proof-reading-topline">
        <p className="proof-reading-caption">当前证明步骤 · 逐步拆解</p>
        <EvidenceBadge inferred={analysis.inferred} />
      </div>

      <section className="proof-reading-section">
        <h4>这一步要解决什么</h4>
        <p><MathText>{analysis.problem}</MathText></p>
      </section>
      <section className="proof-reading-section">
        <h4>为什么这样做</h4>
        <p><MathText>{analysis.reasoning}</MathText></p>
      </section>

      {step.formulas.length > 0 && (
        <section className="proof-reading-section" aria-label="本步公式与推导">
          <h4>把公式和推导写出来</h4>
          {step.formulas.map((formula) => (
            <figure className="proof-formula" key={formula.id}>
              <figcaption><MathText>{formula.label}</MathText></figcaption>
              <div className="proof-formula__math"><BlockMath math={formula.latex} /></div>
              <p><MathText>{formula.explanation}</MathText></p>
              <SourceMeta sourcePage={formula.source_page} inferred={formula.inferred} compact />
              <details className="proof-evidence-disclosure">
                <summary>核对这条公式的原文依据</summary>
                <p lang="en"><MathText>{formula.evidence}</MathText></p>
              </details>
            </figure>
          ))}
        </section>
      )}

      <section className="proof-reading-section proof-reading-outcome">
        <h4>现在得到了什么</h4>
        <p><MathText>{analysis.outcome}</MathText></p>
      </section>
      <section className="proof-reading-section proof-reading-caution">
        <h4>这里不能省略的条件</h4>
        <p><MathText>{analysis.caution}</MathText></p>
      </section>

      <div className="proof-analysis-source">
        <p>以上为根据论文展开的阅读解释与推导。</p>
        <SourceMeta sourcePage={analysis.source_page} inferred={analysis.inferred} compact />
        <details className="proof-evidence-disclosure">
          <summary>核对这段分析的依据</summary>
          <p><MathText>{analysis.evidence}</MathText></p>
        </details>
      </div>

      {dependencies.length > 0 && (
        <section className="proof-reading-section proof-used-steps">
          <h4>接用了前面的哪一步</h4>
          <div>
            {dependencies.map((previous) => (
              <button key={previous.id} type="button" onClick={() => onSelect(previous.id)}>
                步骤 {steps.indexOf(previous) + 1} · {previous.analysis.title}
              </button>
            ))}
          </div>
        </section>
      )}

      {step.prerequisites.length > 0 && (
        <details className="proof-prerequisites">
          <summary>补充：本步用到的符号与前提（{step.prerequisites.length} 项）</summary>
          {step.prerequisites.map((item) => (
            <section key={item.label}>
              <h4><MathText>{item.label}</MathText></h4>
              <p><MathText>{item.text}</MathText></p>
              <SourceMeta sourcePage={item.source_page} inferred={item.inferred} compact />
              <details className="proof-evidence-disclosure">
                <summary>原文依据</summary>
                <p><MathText>{item.evidence}</MathText></p>
              </details>
            </section>
          ))}
        </details>
      )}

      <details className="proof-precise-statement">
        <summary>对照：严谨表述与论文原文</summary>
        <h3><MathText>{step.claim}</MathText></h3>
        <p><MathText>{step.evidence}</MathText></p>
        <SourceMeta sourcePage={step.source_page} inferred={step.inferred} compact />
      </details>
    </article>
  );
}
