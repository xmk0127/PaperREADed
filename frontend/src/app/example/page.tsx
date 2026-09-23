import type { Metadata } from "next";
import { PaperReader } from "@/components/paper-reader";
import { propositionData } from "@/lib/proposition-data";
import { parseReaderTab } from "@/lib/reader-tabs";
import { hasExamplePdf } from "@/lib/example-pdf";

export const metadata: Metadata = { title: "命题 4.1 示例 | PaperREADed" };

export default async function ExamplePage({ searchParams }: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { tab } = await searchParams;
  return <PaperReader key={parseReaderTab(tab)} data={propositionData} initialTab={parseReaderTab(tab)} paperPdfAvailable={await hasExamplePdf()} />;
}
