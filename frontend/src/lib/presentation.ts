import type { SourcePage } from "@/types/proposition";

const mathReplacements: Array<[RegExp, string]> = [
  [/\\operatorname\{Vol\}/g, "Vol"],
  [/\\mathbb\s*\{?C\}?/g, "ℂ"],
  [/\\mathbb\s*\{?R\}?/g, "ℝ"],
  [/\\mathfrak\s*\{?t\}?/g, "𝔱"],
  [/\\mathcal\s*\{?P\}?/g, "𝒫"],
  [/\\mathcal\s*\{?M\}?/g, "ℳ"],
  [/\\mathcal\s*\{?W\}?/g, "𝒲"],
  [/\\mathcal\s*\{?B\}?/g, "ℬ"],
  [/\\mathcal\s*\{?E\}?/g, "ℰ"],
  [/\\mathcal\s*\{?S\}?/g, "𝒮"],
  [/\\mathcal\s*\{?G\}?/g, "𝒢"],
  [/\\Phi/g, "Φ"],
  [/\\tau/g, "τ"],
  [/\\varepsilon/g, "ε"],
  [/\\epsilon/g, "ε"],
  [/\\alpha/g, "α"],
  [/\\lambda/g, "λ"],
  [/\\rho/g, "ρ"],
  [/\\delta/g, "δ"],
  [/\\Sigma/g, "Σ"],
  [/\\pi/g, "π"],
  [/\\nu/g, "ν"],
  [/\\langle/g, "⟨"],
  [/\\rangle/g, "⟩"],
  [/\\lVert|\\rVert/g, "‖"],
  [/\\notin/g, "∉"],
  [/\\in(?![a-zA-Z])/g, "∈"],
  [/\\ge/g, "≥"],
  [/\\le/g, "≤"],
  [/\\pm/g, "±"],
  [/\\to/g, "→"],
  [/\\times/g, "×"],
  [/\\mid/g, "∣"],
  [/\\sum/g, "∑"],
  [/\\int/g, "∫"],
];

export function readableMathText(value: string) {
  return mathReplacements.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    value,
  )
    .replace(/\\([{}])/g, "$1")
    .replace(/[{}]/g, "");
}

export function formatSourcePages(sourcePage: SourcePage) {
  const pdf = sourcePage.pdf.join(", ");
  const printed = sourcePage.printed.join(", ");

  return `PDF 第 ${pdf} 页 · 论文第 ${printed} 页`;
}

const proofTypeLabels: Record<string, string> = {
  construction: "构造",
  singular_locus: "奇异点集",
  excision: "切除",
  calculation: "计算",
  orientation: "定向",
  cobordism: "配边",
  homotopy: "同伦",
  compactness_orientation: "紧性与定向",
  functoriality_conclusion: "函子性与结论",
};

const relationLabels: Record<string, string> = {
  orientation_dependency: "定向依赖",
  sign_justification: "符号依据",
  proof_dependency: "证明依赖",
  downstream_localization: "后续局部化",
  applicability_extension: "适用范围扩展",
  downstream_rewrite: "后续改写",
  downstream_evaluation: "后续求值",
  main_consequence: "主要结论",
};

export function proofTypeLabel(value: string) {
  return proofTypeLabels[value] ?? humanizeIdentifier(value);
}

export function relationLabel(value: string) {
  return relationLabels[value] ?? humanizeIdentifier(value);
}

export function humanizeIdentifier(value: string) {
  return value
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
