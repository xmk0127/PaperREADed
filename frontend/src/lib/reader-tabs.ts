export const readerTabs = [
  { id: "overview", label: "概览" },
  { id: "proof", label: "证明" },
  { id: "relations", label: "关系" },
  { id: "importance", label: "为什么重要" },
] as const;

export type TabId = (typeof readerTabs)[number]["id"];

export function parseReaderTab(value: string | string[] | undefined): TabId {
  return readerTabs.find((tab) => tab.id === value)?.id ?? "overview";
}
