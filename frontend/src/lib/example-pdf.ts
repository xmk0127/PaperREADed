// Server-only filesystem check; do not import from a client component.
import { stat } from "node:fs/promises";
import path from "node:path";

export async function hasExamplePdf(publicDirectory = path.join(process.cwd(), "public")): Promise<boolean> {
  try {
    const file = await stat(path.join(
      publicDirectory, "papers", "wall-crossing-symplectic-vortices.pdf",
    ));
    return file.isFile();
  } catch {
    // A source-only checkout has no bundled third-party PDF. The analysis
    // remains usable; do not advertise a link that would return a 404.
    return false;
  }
}
