export type SourcePage = {
  pdf: number[];
  printed: number[];
};

export type SourcedText = {
  text: string;
  source_page: SourcePage;
  evidence: string;
  inferred: boolean;
};

export type PropositionStatement = SourcedText & {
  label: string;
  formula: string;
  equation_number: string;
};

export type SymbolEntry = {
  symbol: string;
  meaning: string;
  explanation: string;
  source_page: SourcePage;
  evidence: string;
  inferred: boolean;
};

export type ProofStep = {
  id: string;
  type: string;
  claim: string;
  depends_on: string[];
  explanation: string;
  source_page: SourcePage;
  evidence: string;
  inferred: boolean;
  analysis: {
    title: string;
    summary: string;
    problem: string;
    reasoning: string;
    outcome: string;
    caution: string;
    source_page: SourcePage;
    evidence: string;
    inferred: boolean;
  };
  formulas: Array<{
    id: string;
    label: string;
    latex: string;
    explanation: string;
    source_page: SourcePage;
    evidence: string;
    inferred: boolean;
  }>;
  prerequisites: Array<SourcedText & { label: string }>;
};

export type RelationEntry = {
  target: string;
  relation: string;
  explanation: string;
  source_page: SourcePage;
  evidence: string;
  inferred: boolean;
};

export type RelatedStatement = {
  scope: string;
  blocks: Array<
    | { type: "paragraph"; text: string }
    | { type: "formula"; label: string; latex: string }
  >;
  context: Array<{ label: string; text: string; source_page: SourcePage }>;
  source_page: SourcePage;
  evidence: string;
  inferred: boolean;
};

export type RelationAnalysis = {
  title: string;
  lead: string;
  source_page: SourcePage;
  evidence: string;
  inferred: boolean;
  sections: Array<{
    title: string;
    blocks: RelatedStatement["blocks"];
    source_page: SourcePage;
    evidence: string;
    inferred: boolean;
  }>;
};

export type ProofNarrative = {
  title: string;
  introduction: SourcedText;
  sections: Array<{
    id: string;
    title: string;
    blocks: Array<
      | { type: "paragraph"; text: string }
      | { type: "formula"; formula_id: string }
    >;
    source_page: SourcePage;
    evidence: string;
    inferred: boolean;
  }>;
};

export type PropositionData = {
  importance_reading: {
    lead: SourcedText;
    comparison: {
      title: string;
      notation: ImportanceFormula;
      before: ImportanceFormula;
      after: ImportanceFormula;
    };
    geometry: {
      title: string;
      introduction: SourcedText;
      panels: Array<{ title: string; space: string; top: string; bottom: string; center: string; center_label: string; caption: string }>;
      condition: ImportanceFormula;
      identity: ImportanceFormula;
      caution: SourcedText;
    };
    calculation: {
      title: string;
      introduction: SourcedText;
      rows: ImportanceFormula[];
      conclusion: SourcedText;
    };
    limits: SourcedText;
  };
  statement: PropositionStatement;
  intuitive_explanation: SourcedText;
  symbols: SymbolEntry[];
  proof: {
    logic: {
      title: string;
      notation: string;
      goal_formula_id: string;
      backbone: Array<{ label: string; formula_id: string; reason: string }>;
      setup: { title: string; formula_ids: string[]; context: string } & Omit<SourcedText, "text">;
      arguments: Array<{
        id: string;
        title: string;
        formula_ids: string[];
        uses: string[];
        reason: string;
        result: string;
        source_page: SourcePage;
        evidence: string;
        inferred: boolean;
      }>;
      conclusion: SourcedText;
    };
    logic_formulas: ProofStep["formulas"];
    goal: SourcedText;
    strategy: SourcedText;
    narrative: ProofNarrative;
    steps: ProofStep[];
  };
  relations: RelationEntry[];
  related_statements: Record<string, RelatedStatement>;
  relation_analysis: Record<string, RelationAnalysis>;
  relations_reading: {
    title: string;
    summary: SourcedText;
    groups: Array<{
      id: string;
      title: string;
      relations: string[];
    }>;
  };
  importance: {
    role_in_paper: SourcedText;
    conceptual_importance: SourcedText;
    what_problem_it_reduces: SourcedText;
    downstream_use: SourcedText;
  };
};

export type ImportanceFormula = SourcedText & { label: string; latex: string };
