import { PaperReader } from "@/components/paper-reader";
import { LocalReader } from "@/components/local-reader";
import { propositionData } from "@/lib/proposition-data";
import { parseReaderTab } from "@/lib/reader-tabs";
import { hasExamplePdf } from "@/lib/example-pdf";

export default async function Page({ searchParams }: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { tab } = await searchParams;
  if (tab === undefined) return <LocalReader />;
  return <PaperReader key={parseReaderTab(tab)} data={propositionData} initialTab={parseReaderTab(tab)} paperPdfAvailable={await hasExamplePdf()} />;
}
