export type CodexStatus = {
  installed: boolean;
  authenticated: boolean;
  auth_method: "chatgpt" | "api_key" | "none";
  version: string | null;
  message: string;
};

export type LocalPaper = {
  id: string;
  title: string;
  filename: string;
  page_count: number;
  created_at: string;
  text_available: boolean;
  warnings: string[];
};

export type AnalysisSource = {
  pages: number[];
  evidence: string;
  inferred: boolean;
};

export type AnalysisBlock = {
  kind: "paragraph" | "formula";
  text: string;
  source: AnalysisSource;
};

export type AnalysisSection = {
  title: string;
  blocks: AnalysisBlock[];
};

export type AnalysisResult = {
  title: string;
  target_found: boolean;
  statement: AnalysisBlock[];
  intuitive_explanation: AnalysisBlock[];
  symbols: {
    symbol: string;
    meaning: string;
    explanation: string;
    source: AnalysisSource;
  }[];
  proof: {
    goal: AnalysisBlock[];
    strategy: AnalysisBlock[];
    sections: AnalysisSection[];
  };
  relations: {
    target: string;
    statement: AnalysisBlock[];
    explanation: AnalysisBlock[];
  }[];
  importance: AnalysisSection[];
  limitations: string[];
};

export type AnalysisJob = {
  id: string;
  paper_id: string;
  target: string;
  instructions: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  stage: string;
  created_at: string;
  updated_at: string;
  error: string | null;
  result: AnalysisResult | null;
};
