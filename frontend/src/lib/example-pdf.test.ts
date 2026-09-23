import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hasExamplePdf } from "./example-pdf";

describe("本机示例 PDF 检测", () => {
  let publicDirectory: string;
  let pdfPath: string;

  beforeEach(async () => {
    publicDirectory = await mkdtemp(path.join(os.tmpdir(), "paperreaded-pdf-test-"));
    await mkdir(path.join(publicDirectory, "papers"));
    pdfPath = path.join(publicDirectory, "papers", "wall-crossing-symplectic-vortices.pdf");
  });

  afterEach(async () => {
    if (publicDirectory) await rm(publicDirectory, { recursive: true, force: true });
  });

  it("本机存在普通 PDF 文件时启用原文入口", async () => {
    // Only checks asset existence; no third-party paper needs to be bundled.
    await writeFile(pdfPath, "%PDF-1.7\n");
    expect(await hasExamplePdf(publicDirectory)).toBe(true);
  });

  it("未附带 PDF 的公开源码包仍可正常读取示例", async () => {
    expect(await hasExamplePdf(publicDirectory)).toBe(false);
  });

  it("同名目录不是可打开的 PDF", async () => {
    await mkdir(pdfPath);
    expect(await hasExamplePdf(publicDirectory)).toBe(false);
  });
});
