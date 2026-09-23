import { useState } from "react";
import { BlockMath } from "react-katex";

import { formatSourcePages, relationLabel } from "@/lib/presentation";
import type { PropositionData, RelatedStatement, RelationAnalysis, RelationEntry, SourcePage } from "@/types/proposition";

import { MathText } from "./math-text";
import { EvidenceBadge, SourceMeta } from "./source-meta";

function RelationEvidence({ source_page, evidence, inferred }: {
  source_page: SourcePage;
  evidence: string;
  inferred: boolean;
}) {
  return (
    <details className="relations-reading__evidence">
      <summary>
        <EvidenceBadge inferred={inferred} />
        <span>{formatSourcePages(source_page)}</span>
        <span className="relations-reading__evidence-label">原文依据</span>
      </summary>
      <p><MathText>{evidence}</MathText></p>
      <SourceMeta sourcePage={source_page} inferred={inferred} compact />
    </details>
  );
}

function ReadingBlocks({ blocks, variant = "statement" }: {
  blocks: RelatedStatement["blocks"];
  variant?: "statement" | "prose";
}) {
  return blocks.map((block, index) => block.type === "paragraph" ? (
    <p key={index}><MathText>{block.text}</MathText></p>
  ) : (
    <figure className={variant === "prose" ? "related-statement__formula reading-equation" : "related-statement__formula"} key={index}>
      <figcaption className={variant === "prose" ? "visually-hidden" : undefined}><MathText>{block.label}</MathText></figcaption>
      <div className="related-statement__math" tabIndex={0} role="group" aria-label={block.label}>
        <BlockMath math={block.latex} />
      </div>
    </figure>
  ));
}

function RelationRow({ relation, statement, analysis }: { relation: RelationEntry; statement: RelatedStatement; analysis: RelationAnalysis }) {
  const [expanded, setExpanded] = useState(false);
  const statementId = `related-statement-${relation.relation}`;

  return (
    <section className="relations-reading__item" aria-labelledby={`relation-${relation.relation}`}>
      <div className="relations-reading__target">
        <h4 id={`relation-${relation.relation}`}>
          <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls={statementId}>
            {relation.target}
          </button>
        </h4>
        <span>{relationLabel(relation.relation)}</span>
        <button
          type="button"
          className="relations-reading__toggle"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-controls={statementId}
          aria-label={`${relation.target}：${expanded ? "收起" : "查看"}结论与公式`}
        >
          {expanded ? "收起结论与公式" : "查看结论与公式"}
        </button>
      </div>
      <div className="related-statement" id={statementId} hidden={!expanded}>
        <div className="related-statement__heading">
          <h5>结论陈述</h5>
          <span>{statement.scope}</span>
        </div>
        <ReadingBlocks blocks={statement.blocks} />
        <SourceMeta sourcePage={statement.source_page} inferred={statement.inferred} compact />
        <details className="related-statement__context">
          <summary>符号定义与适用前提</summary>
          <dl>
            {statement.context.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>
                  <p><MathText>{item.text}</MathText></p>
                  <SourceMeta sourcePage={item.source_page} inferred={statement.inferred} compact />
                </dd>
              </div>
            ))}
          </dl>
        </details>
        <RelationEvidence {...statement} />
      </div>
      <section className="relation-interpretation" aria-labelledby={`interpretation-${relation.relation}`}>
        <h5 id={`interpretation-${relation.relation}`}>{analysis.title}</h5>
        <p className="relations-reading__explanation"><MathText>{analysis.lead}</MathText></p>
        <div className="relation-interpretation__status">
          <span>基于原文展开的关系推导；不是论文逐字陈述</span>
        </div>
        <RelationEvidence {...analysis} />
        {analysis.sections.map((section, index) => (
          <section className="relation-interpretation__section" key={section.title} aria-labelledby={`interpretation-${relation.relation}-${index}`}>
            <h6 id={`interpretation-${relation.relation}-${index}`}>{section.title}</h6>
            <ReadingBlocks blocks={section.blocks} variant="prose" />
            <RelationEvidence {...section} />
          </section>
        ))}
        <details className="relations-reading__evidence relations-reading__association-evidence">
          <summary>
            <EvidenceBadge inferred={relation.inferred} />
            <span>{formatSourcePages(relation.source_page)}</span>
            <span className="relations-reading__evidence-label">论文中直接说明的关系</span>
          </summary>
          <p><MathText>{relation.explanation}</MathText></p>
          <p><MathText>{relation.evidence}</MathText></p>
          <SourceMeta sourcePage={relation.source_page} inferred={relation.inferred} compact />
        </details>
      </section>
    </section>
  );
}

export function RelationsReading({ data }: { data: PropositionData }) {
  const { title, summary, groups } = data.relations_reading;
  const relations = new Map(data.relations.map((relation) => [relation.relation, relation]));

  return (
    <article className="tab-content relations-reading" aria-labelledby="relations-reading-title">
      <header className="relations-reading__intro">
        <p className="panel-kicker">命题 4.1 · 在论文中的位置</p>
        <h2 id="relations-reading-title">{title}</h2>
        <p className="relations-reading__summary"><MathText>{summary.text}</MathText></p>
        <RelationEvidence {...summary} />
      </header>

      <nav className="relations-reading__index" aria-label="关系解读目录">
        {groups.flatMap((group) => group.relations).map((key) => (
          <a href={`#relation-${key}`} key={key}>{relations.get(key)?.target}</a>
        ))}
      </nav>

      {groups.map((group) => (
        <section className="relations-reading__group" id={`relations-${group.id}`} key={group.id} aria-labelledby={`relations-heading-${group.id}`}>
          <h3 id={`relations-heading-${group.id}`}>{group.title}</h3>
          <div className="relations-reading__list">
            {group.relations.map((key) => {
              const relation = relations.get(key);
              if (!relation) throw new Error(`Missing relation: ${key}`);
              const statement = data.related_statements[key];
              if (!statement) throw new Error(`Missing related statement: ${key}`);
              const analysis = data.relation_analysis[key];
              if (!analysis) throw new Error(`Missing relation analysis: ${key}`);
              return (
                <RelationRow relation={relation} statement={statement} analysis={analysis} key={key} />
              );
            })}
          </div>
        </section>
      ))}
    </article>
  );
}
