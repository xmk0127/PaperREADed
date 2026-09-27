import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AnalysisJob, AnalysisResult, CodexStatus, LocalPaper } from "@/types/local-analysis";
import { LocalReader, reconcileJobs } from "./local-reader";

const loggedIn: CodexStatus = { installed: true, authenticated: true, auth_method: "chatgpt", version: "1.0", message: "已登录" };
const paper: LocalPaper = { id: "paper-1", filename: "paper.pdf", title: "Paper", page_count: 12, created_at: "2026-09-20T00:00:00Z", text_available: true, warnings: [] };
const newPaper: LocalPaper = { ...paper, id: "paper-2", filename: "String topology for stacks.pdf", title: "String topology for stacks", page_count: 88 };
const source = { pages: [2], evidence: "Original statement.", inferred: false };
const result: AnalysisResult = {
  title: "命题 4.1", target_found: true, statement: [{ kind: "paragraph", text: "这是已保存的结果。", source }],
  symbols: [], intuitive_explanation: [], proof: { goal: [], strategy: [], sections: [] }, relations: [], importance: [], limitations: [],
};
const job: AnalysisJob = { id: "job-1", paper_id: paper.id, target: "Proposition 4.1", instructions: "解释关键步骤", status: "completed", stage: "完成", created_at: "2026-09-20T00:00:00Z", updated_at: "2026-09-20T00:00:00Z", error: null, result };
function response(data: unknown, ok = true, status = 200) { return { ok, status, json: async () => data } as Response; }
function mockApi({ status = loggedIn, papers = [paper], jobs = [] as AnalysisJob[], extra }: { status?: CodexStatus; papers?: LocalPaper[]; jobs?: AnalysisJob[]; extra?: (url: string, init?: RequestInit) => Response | Promise<Response> | undefined } = {}) {
  const mock = vi.fn((url: string, init?: RequestInit) => {
    const supplied = extra?.(url, init);
    if (supplied) return Promise.resolve(supplied);
    if (url.endsWith("/codex/status")) return Promise.resolve(response(status));
    if (url.endsWith("/papers") && !init?.method) return Promise.resolve(response(papers));
    if (url.endsWith("/analyses") && !init?.method) return Promise.resolve(response(jobs));
    throw new Error(`Unmocked request: ${url} ${init?.method ?? "GET"}`);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("LocalReader", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); window.localStorage.clear(); });

  it("未登录时说明终端登录流程，禁用分析，没有 API Key 输入", async () => {
    mockApi({ status: { ...loggedIn, authenticated: false, auth_method: "none", message: "请登录" } });
    render(<LocalReader />);
    await screen.findByText("需要本机 Codex 的 ChatGPT 登录");
    expect(screen.getByText("codex login")).toBeVisible();
    expect(screen.getByRole("button", { name: "开始分析" })).toBeDisabled();
    expect(screen.queryByRole("textbox", { name: /API Key/i })).toBeNull();
    expect(screen.getByRole("link", { name: "阅读示例：命题 4.1" })).toHaveAttribute("href", "/example");
  });

  it("API Key 登录不能用于开始分析", async () => {
    mockApi({ status: { ...loggedIn, auth_method: "api_key" } });
    render(<LocalReader />);
    expect(await screen.findByText("codex logout")).toBeVisible();
    expect(screen.getByRole("button", { name: "开始分析" })).toBeDisabled();
  });

  it("导入只保存本机，具体结果和发送同意都具备后才提交，并可取消", async () => {
    const user = userEvent.setup();
    const running = { ...job, status: "running" as const, stage: "正在读取指定结论", result: null };
    const mock = mockApi({ papers: [], extra: (url, init) => {
      if (url.endsWith("/papers") && init?.method === "POST") return response(paper);
      if (url.endsWith("/analyses") && init?.method === "POST") return response(running);
      if (url.endsWith("/analyses/job-1")) return response(running);
      if (url.endsWith("/analyses/job-1/cancel")) return response({ ...running, status: "cancelled", updated_at: "2026-09-20T00:01:00Z" });
    } });
    render(<LocalReader />);
    await screen.findByText("已检测到本机 Codex · ChatGPT 已登录");
    await user.upload(screen.getByLabelText("导入 PDF"), new File(["%PDF-1.7"], "paper.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: "导入到本机" }));
    await screen.findByText(/已导入 paper.pdf/);
    expect(mock.mock.calls.filter(([url, init]) => url.endsWith("/analyses") && init?.method === "POST")).toHaveLength(0);
    await user.type(screen.getByRole("textbox", { name: /要分析的具体结果/ }), "Proposition 4.1");
    expect(screen.getByRole("button", { name: "开始分析" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "开始分析" }));
    await screen.findByText("正在读取指定结论");
    const submit = mock.mock.calls.find(([url, init]) => url.endsWith("/analyses") && init?.method === "POST")!;
    expect(JSON.parse(submit[1]!.body as string)).toEqual({ paper_id: "paper-1", target: "Proposition 4.1", instructions: "", processing_consent: true });
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "取消分析" }));
    await screen.findByText(/任务已取消。/);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("选择新文件立即撤销旧论文的发送同意，未导入时不能提交旧论文", async () => {
    const user = userEvent.setup();
    const mock = mockApi();
    render(<LocalReader />);
    await screen.findByText("已检测到本机 Codex · ChatGPT 已登录");
    await user.type(screen.getByRole("textbox", { name: /要分析的具体结果/ }), "公式 (13.3)");
    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "开始分析" })).toBeEnabled();
    await user.upload(screen.getByLabelText("导入 PDF"), new File(["%PDF-1.7"], newPaper.filename, { type: "application/pdf" }));

    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "当前论文" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "当前论文" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "开始分析" })).toBeDisabled();
    expect(screen.getByText(/尚未导入/)).toHaveTextContent(newPaper.filename);
    expect(screen.queryByRole("link", { name: "打开原论文（新标签页）" })).toBeNull();
    fireEvent.submit(screen.getByRole("form", { name: "导入论文并指定结论" }));
    expect(mock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("默认本地 PDF，可切换 arXiv；只输入链接不会联网导入且不能分析旧论文", async () => {
    const user = userEvent.setup();
    const mock = mockApi();
    render(<LocalReader />);
    await screen.findByText("已检测到本机 Codex · ChatGPT 已登录");
    expect(screen.getByRole("radio", { name: "本地 PDF" })).toBeChecked();
    expect(screen.getByLabelText("导入 PDF")).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "arXiv 链接或编号" })).toBeNull();
    await user.type(screen.getByRole("textbox", { name: /要分析的具体结果/ }), "Theorem 1");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("radio", { name: "arXiv 论文" }));
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.queryByLabelText("导入 PDF")).toBeNull();
    expect(screen.getByRole("button", { name: "下载并导入" })).toBeDisabled();
    expect(screen.getByText(/点击后会联网从 arXiv 下载 PDF/)).toBeVisible();
    await user.click(screen.getByRole("checkbox"));
    await user.type(screen.getByRole("textbox", { name: "arXiv 链接或编号" }), "https://arxiv.org/pdf/2309.07041");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "当前论文" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "当前论文" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "开始分析" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: "打开原论文（新标签页）" })).toBeNull();
    fireEvent.submit(screen.getByRole("form", { name: "导入论文并指定结论" }));
    expect(mock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it.each(["https://arxiv.org/pdf/2309.07041", "https://arxiv.org/abs/2309.07041v2", "2309.07041"])("arXiv 导入 %s 后选中新论文，并要求重新同意才发起分析", async (reference) => {
    const user = userEvent.setup();
    const imported = { ...newPaper, filename: "arxiv-2309.07041.pdf" };
    const mock = mockApi({ extra: (url, init) => {
      if (url.endsWith("/papers/arxiv") && init?.method === "POST") return response(imported, true, 201);
      if (url.endsWith("/analyses") && init?.method === "POST") return response({ ...job, paper_id: imported.id });
    } });
    render(<LocalReader />);
    await screen.findByText("已检测到本机 Codex · ChatGPT 已登录");
    await user.type(screen.getByRole("textbox", { name: /要分析的具体结果/ }), "Theorem 1");
    await user.click(screen.getByRole("radio", { name: "arXiv 论文" }));
    await user.type(screen.getByRole("textbox", { name: "arXiv 链接或编号" }), ` ${reference} `);
    await user.click(screen.getByRole("button", { name: "下载并导入" }));
    await screen.findByText(/已导入 arxiv-2309.07041.pdf/);
    expect(mock.mock.calls.filter(([, init]) => init?.method === "POST")).toEqual([
      ["/api/local/papers/arxiv", expect.objectContaining({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference }) })],
    ]);
    expect(screen.getByRole("textbox", { name: "arXiv 链接或编号" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "当前论文" })).toHaveValue(imported.id);
    expect(window.localStorage.getItem("paper-reader-paper")).toBe(imported.id);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "开始分析" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "打开原论文（新标签页）" })).toHaveAttribute("href", "/api/local/papers/paper-2/pdf");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "开始分析" }));
    await screen.findByText(/分析已提交/);
    const submit = mock.mock.calls.find(([url, init]) => url.endsWith("/analyses") && init?.method === "POST")!;
    expect(JSON.parse(submit[1]!.body as string).paper_id).toBe(imported.id);
  });

  it("arXiv 下载失败保留输入和错误，不会回退到旧论文，取消输入后也要重新同意", async () => {
    const user = userEvent.setup();
    const mock = mockApi({ extra: (url, init) => url.endsWith("/papers/arxiv") && init?.method === "POST"
      ? response({ detail: "arXiv 下载超时，请稍后重试。" }, false, 504) : undefined });
    render(<LocalReader />);
    await screen.findByText("已检测到本机 Codex · ChatGPT 已登录");
    await user.type(screen.getByRole("textbox", { name: /要分析的具体结果/ }), "Theorem 1");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("radio", { name: "arXiv 论文" }));
    await user.type(screen.getByRole("textbox", { name: "arXiv 链接或编号" }), "2309.07041");
    await user.click(screen.getByRole("button", { name: "下载并导入" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("arXiv 下载超时");
    expect(screen.getByRole("textbox", { name: "arXiv 链接或编号" })).toHaveValue("2309.07041");
    expect(screen.getByRole("combobox", { name: "当前论文" })).toHaveValue("");
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "开始分析" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下载并导入" })).toBeEnabled();
    fireEvent.submit(screen.getByRole("form", { name: "导入论文并指定结论" }));
    expect(mock.mock.calls.some(([url, init]) => url.endsWith("/analyses") && init?.method === "POST")).toBe(false);
    await user.click(screen.getByRole("button", { name: "取消输入" }));
    expect(screen.getByRole("textbox", { name: "arXiv 链接或编号" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "当前论文" })).toHaveValue(paper.id);
    expect(screen.getByRole("checkbox")).toBeEnabled();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "开始分析" })).toBeDisabled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("切换导入方式清除文件或 arXiv 输入并撤销同意，原论文和历史不变", async () => {
    const user = userEvent.setup();
    const mock = mockApi({ jobs: [job] });
    render(<LocalReader />);
    await screen.findByText("这是已保存的结果。");
    await user.upload(screen.getByLabelText("导入 PDF"), new File(["%PDF-1.7"], newPaper.filename, { type: "application/pdf" }));
    await user.click(screen.getByRole("radio", { name: "arXiv 论文" }));
    expect(screen.queryByText(/尚未导入/)).toBeNull();
    expect(screen.getByRole("combobox", { name: "当前论文" })).toHaveValue(paper.id);
    await user.type(screen.getByRole("textbox", { name: "arXiv 链接或编号" }), "2309.07041");
    await user.click(screen.getByRole("radio", { name: "本地 PDF" }));
    expect((screen.getByLabelText("导入 PDF") as HTMLInputElement).files).toHaveLength(0);
    expect(screen.queryByText(/尚未导入/)).toBeNull();
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("radio", { name: "arXiv 论文" }));
    expect(screen.getByRole("textbox", { name: "arXiv 链接或编号" })).toHaveValue("");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByText("这是已保存的结果。")).toBeVisible();
    expect(mock.mock.calls.some(([, init]) => init?.method)).toBe(false);
  });

  it("arXiv 下载期间禁用模式、输入、刷新、取消输入和历史重试，完成后选中新论文", async () => {
    const user = userEvent.setup();
    let finishImport!: (value: Response) => void;
    const mock = mockApi({ jobs: [{ ...job, status: "failed", result: null, error: "旧任务失败" }], extra: (url, init) => {
      if (url.endsWith("/papers/arxiv") && init?.method === "POST") return new Promise((resolve) => { finishImport = resolve; });
    } });
    render(<LocalReader />);
    await screen.findByText("旧任务失败");
    await user.click(screen.getByRole("radio", { name: "arXiv 论文" }));
    await user.type(screen.getByRole("textbox", { name: "arXiv 链接或编号" }), "2309.07041");
    await user.click(screen.getByRole("button", { name: "下载并导入" }));
    expect(screen.getByRole("button", { name: "正在下载并导入…" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "本地 PDF" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "arXiv 论文" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "arXiv 链接或编号" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消输入" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "刷新记录" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "修改问题并重新分析" })).toBeDisabled();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: "本地 PDF" }));
    expect(screen.getByRole("radio", { name: "arXiv 论文" })).toBeChecked();
    await act(async () => finishImport(response(newPaper)));
    expect(screen.getByRole("combobox", { name: "当前论文" })).toHaveValue(newPaper.id);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(mock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("重试历史任务清除待导入的 arXiv 输入，不下载也不自动分析", async () => {
    const user = userEvent.setup();
    const mock = mockApi({ jobs: [{ ...job, status: "failed", result: null, error: "旧任务失败" }] });
    render(<LocalReader />);
    await screen.findByText("旧任务失败");
    await user.click(screen.getByRole("radio", { name: "arXiv 论文" }));
    await user.type(screen.getByRole("textbox", { name: "arXiv 链接或编号" }), "2309.07041");
    await user.click(screen.getByRole("button", { name: "修改问题并重新分析" }));
    expect(screen.getByRole("textbox", { name: "arXiv 链接或编号" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "当前论文" })).toHaveValue(paper.id);
    expect(screen.getByRole("textbox", { name: /要分析的具体结果/ })).toHaveValue(job.target);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent("待导入的文件或 arXiv 输入已清除");
    expect(mock.mock.calls.some(([, init]) => init?.method)).toBe(false);
  });

  it("新论文成功导入后清空文件选择，只有重新同意才提交新论文 ID", async () => {
    const user = userEvent.setup();
    const mock = mockApi({ extra: (url, init) => {
      if (url.endsWith("/papers") && init?.method === "POST") return response(newPaper);
      if (url.endsWith("/analyses") && init?.method === "POST") return response({ ...job, paper_id: newPaper.id });
    } });
    render(<LocalReader />);
    await screen.findByText("已检测到本机 Codex · ChatGPT 已登录");
    await user.type(screen.getByRole("textbox", { name: /要分析的具体结果/ }), "公式 (13.3)");
    await user.click(screen.getByRole("checkbox"));
    const input = screen.getByLabelText("导入 PDF") as HTMLInputElement;
    const upload = new File(["%PDF-1.7"], newPaper.filename, { type: "application/pdf" });
    await user.upload(input, upload);
    await user.click(screen.getByRole("button", { name: "导入到本机" }));
    await screen.findByText(/已导入 String topology for stacks.pdf/);

    expect(input).toHaveValue("");
    expect(input.files).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "取消选择" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "当前论文" })).toHaveValue(newPaper.id);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "开始分析" })).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "导入论文并指定结论" }));
    expect(mock.mock.calls.filter(([url, init]) => url.endsWith("/analyses") && init?.method === "POST")).toHaveLength(0);
    const importCall = mock.mock.calls.find(([url, init]) => url.endsWith("/papers") && init?.method === "POST")!;
    expect((importCall[1]!.body as FormData).get("file")).toBe(upload);
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "开始分析" }));
    await screen.findByText(/分析已提交/);
    const submissions = mock.mock.calls.filter(([url, init]) => url.endsWith("/analyses") && init?.method === "POST");
    expect(submissions).toHaveLength(1);
    expect(JSON.parse(submissions[0][1]!.body as string)).toEqual({ paper_id: newPaper.id, target: "公式 (13.3)", instructions: "", processing_consent: true });
  });

  it("新文件导入失败后仍保持待导入状态，不能回退分析旧论文", async () => {
    const user = userEvent.setup();
    const mock = mockApi({ extra: (url, init) => url.endsWith("/papers") && init?.method === "POST"
      ? response({ detail: "无法解析新 PDF" }, false, 422) : undefined });
    render(<LocalReader />);
    await screen.findByText("已检测到本机 Codex · ChatGPT 已登录");
    await user.type(screen.getByRole("textbox", { name: /要分析的具体结果/ }), "公式 (13.3)");
    await user.click(screen.getByRole("checkbox"));
    const input = screen.getByLabelText("导入 PDF") as HTMLInputElement;
    await user.upload(input, new File(["bad PDF"], newPaper.filename, { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: "导入到本机" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("无法解析新 PDF");
    expect(input.files?.[0]?.name).toBe(newPaper.filename);
    expect(screen.getByRole("combobox", { name: "当前论文" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "当前论文" })).toBeDisabled();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "开始分析" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "导入到本机" })).toBeEnabled();
    fireEvent.submit(screen.getByRole("form", { name: "导入论文并指定结论" }));
    expect(mock.mock.calls.filter(([url, init]) => url.endsWith("/analyses") && init?.method === "POST")).toHaveLength(0);
  });

  it("取消待导入文件清空原生输入并恢复旧论文，但不恢复发送同意", async () => {
    const user = userEvent.setup();
    const mock = mockApi();
    render(<LocalReader />);
    await screen.findByText("已检测到本机 Codex · ChatGPT 已登录");
    await user.type(screen.getByRole("textbox", { name: /要分析的具体结果/ }), "Proposition 4.1");
    await user.click(screen.getByRole("checkbox"));
    const input = screen.getByLabelText("导入 PDF") as HTMLInputElement;
    await user.upload(input, new File(["%PDF-1.7"], newPaper.filename, { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: "取消选择" }));
    expect(input).toHaveValue("");
    expect(input.files).toHaveLength(0);
    expect(screen.getByRole("combobox", { name: "当前论文" })).toHaveValue(paper.id);
    expect(screen.getByRole("combobox", { name: "当前论文" })).toBeEnabled();
    expect(screen.getByRole("checkbox")).toBeEnabled();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "开始分析" })).toBeDisabled();
    expect(screen.queryByText(/尚未导入/)).toBeNull();
    expect(mock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("重试旧任务清除待导入的新文件，明确恢复旧论文且不直接提交", async () => {
    const user = userEvent.setup();
    const mock = mockApi({ jobs: [{ ...job, status: "failed", result: null, error: "旧任务失败" }] });
    render(<LocalReader />);
    await screen.findByText("旧任务失败");
    const input = screen.getByLabelText("导入 PDF") as HTMLInputElement;
    await user.upload(input, new File(["%PDF-1.7"], newPaper.filename, { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: "修改问题并重新分析" }));
    expect(input).toHaveValue("");
    expect(input.files).toHaveLength(0);
    expect(screen.queryByText(/尚未导入/)).toBeNull();
    expect(screen.getByRole("combobox", { name: "当前论文" })).toHaveValue(paper.id);
    expect(screen.getByRole("textbox", { name: /要分析的具体结果/ })).toHaveValue(job.target);
    expect(screen.getByRole("textbox", { name: /还想弄清什么/ })).toHaveValue(job.instructions);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent(paper.filename);
    expect(mock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("导入中禁止重试旧任务、切换文件或同意，完成后保持新论文", async () => {
    const user = userEvent.setup();
    let finishImport!: (value: Response) => void;
    const mock = mockApi({ jobs: [{ ...job, status: "failed", result: null, error: "旧任务失败" }], extra: (url, init) => {
      if (url.endsWith("/papers") && init?.method === "POST") return new Promise((resolve) => { finishImport = resolve; });
    } });
    render(<LocalReader />);
    await screen.findByText("旧任务失败");
    await user.type(screen.getByRole("textbox", { name: /要分析的具体结果/ }), "公式 (13.3)");
    await user.upload(screen.getByLabelText("导入 PDF"), new File(["%PDF-1.7"], newPaper.filename, { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: "导入到本机" }));
    expect(screen.getByRole("button", { name: "正在导入…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "修改问题并重新分析" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消选择" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "当前论文" })).toBeDisabled();
    expect(screen.getByLabelText("导入 PDF")).toBeDisabled();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "修改问题并重新分析" }));
    expect(screen.getByRole("textbox", { name: /要分析的具体结果/ })).toHaveValue("公式 (13.3)");
    await act(async () => finishImport(response(newPaper)));
    expect(screen.getByRole("combobox", { name: "当前论文" })).toHaveValue(newPaper.id);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "开始分析" })).toBeDisabled();
    expect(mock.mock.calls.filter(([url, init]) => url.endsWith("/analyses") && init?.method === "POST")).toHaveLength(0);
  });

  it("重试已丢失论文的历史任务不会回退到另一篇论文", async () => {
    const user = userEvent.setup();
    const mock = mockApi({ papers: [newPaper], jobs: [{ ...job, status: "failed", result: null, error: "旧任务失败" }] });
    render(<LocalReader />);
    await screen.findByText("旧任务失败");
    expect(screen.getByRole("combobox", { name: "当前论文" })).toHaveValue(newPaper.id);
    await user.click(screen.getByRole("button", { name: "修改问题并重新分析" }));
    expect(screen.getByRole("combobox", { name: "当前论文" })).toHaveValue("");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "开始分析" })).toBeDisabled();
    expect(within(screen.getByRole("form", { name: "导入论文并指定结论" })).getByRole("alert")).toBeVisible();
    expect(mock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("刷新期间禁止提交，原论文从库中消失后切换论文也必须重新同意", async () => {
    const user = userEvent.setup();
    let reads = 0;
    let finishRefresh!: (value: Response) => void;
    const mock = mockApi({ papers: [paper, newPaper], extra: (url, init) => {
      if (url.endsWith("/papers") && !init?.method && ++reads > 1) {
        return new Promise((resolve) => { finishRefresh = resolve; });
      }
    } });
    render(<LocalReader />);
    await screen.findByText("已检测到本机 Codex · ChatGPT 已登录");
    await user.type(screen.getByRole("textbox", { name: /要分析的具体结果/ }), "Proposition 4.1");
    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("combobox", { name: "当前论文" })).toHaveValue(paper.id);
    expect(screen.getByRole("button", { name: "开始分析" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "刷新记录" }));
    expect(screen.getByRole("button", { name: "开始分析" })).toBeDisabled();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    fireEvent.submit(screen.getByRole("form", { name: "导入论文并指定结论" }));
    expect(mock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    await act(async () => finishRefresh(response([newPaper])));
    expect(screen.getByRole("combobox", { name: "当前论文" })).toHaveValue(newPaper.id);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "开始分析" })).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "导入论文并指定结论" }));
    expect(mock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("刷新恢复服务器历史结果，不自动调用 AI", async () => {
    const mock = mockApi({ jobs: [job] });
    window.localStorage.setItem("paper-reader-job", job.id);
    render(<LocalReader />);
    expect(await screen.findByText("这是已保存的结果。")).toBeVisible();
    expect(screen.getByRole("button", { name: "下载分析 JSON" })).toBeVisible();
    expect(mock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("失败重试只回填表单，不自动消耗新配额", async () => {
    const user = userEvent.setup();
    const mock = mockApi({ jobs: [{ ...job, status: "failed", result: null, error: "配额不足" }] });
    render(<LocalReader />);
    await screen.findByText("配额不足");
    await user.click(screen.getByRole("button", { name: "修改问题并重新分析" }));
    expect(screen.getByRole("textbox", { name: /要分析的具体结果/ })).toHaveValue(job.target);
    expect(screen.getByRole("textbox", { name: /还想弄清什么/ })).toHaveValue(job.instructions);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(mock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("扫描件不可分析，错误请求可以显示具体原因", async () => {
    const user = userEvent.setup();
    mockApi({ papers: [{ ...paper, text_available: false, warnings: ["未提取到文本"] }] });
    render(<LocalReader />);
    await screen.findByText("未提取到文本");
    await user.type(screen.getByRole("textbox", { name: /要分析的具体结果/ }), "Theorem 1");
    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "开始分析" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("不会发起 AI 分析");
  });

  it("正在读取历史结果时，后台任务响应不会抢走当前选择", async () => {
    const user = userEvent.setup();
    let resolvePoll!: (response: Response) => void;
    const running = { ...job, id: "job-2", target: "Lemma 2", status: "running" as const, result: null };
    mockApi({ jobs: [running, job], extra: (url) => url.endsWith("/analyses/job-2") ? new Promise((resolve) => { resolvePoll = resolve; }) : undefined });
    render(<LocalReader />);
    const history = screen.getByRole("complementary", { name: "本机阅读记录" });
    await user.click(await within(history).findByRole("button", { name: /^Proposition 4.1/ }));
    await screen.findByText("这是已保存的结果。");
    await act(async () => resolvePoll(response({ ...running, status: "completed", result: { ...result, title: "引理 2" }, updated_at: "2026-09-20T00:01:00Z" })));
    expect(screen.getByRole("heading", { name: "命题 4.1" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "引理 2" })).toBeNull();
  });

  it("进度请求失败后只重试读取，不重新发送分析", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const running = { ...job, status: "running" as const, result: null };
    const mock = mockApi({ jobs: [running], extra: (url) => {
      if (url.endsWith("/analyses/job-1")) {
        attempts += 1;
        return attempts === 1 ? response({ detail: "本地服务不可用" }, false, 503) : response(job);
      }
    } });
    render(<LocalReader />);
    await screen.findByText(/暂时无法获取分析状态/);
    await user.click(screen.getByRole("button", { name: "重新获取进度" }));
    await waitFor(() => expect(screen.getByText("这是已保存的结果。")).toBeVisible());
    expect(attempts).toBe(2);
    expect(mock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("删除确认说明具体记录、PDF 保留及不可撤销，取消确认不发请求", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const mock = mockApi({ jobs: [job] });
    render(<LocalReader />);
    await screen.findByText("这是已保存的结果。");
    await user.click(screen.getByRole("button", { name: /^删除记录：Proposition 4.1/ }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0][0]).toContain(job.target);
    expect(confirm.mock.calls[0][0]).toContain(paper.filename);
    expect(confirm.mock.calls[0][0]).toContain("已导入的 PDF 会保留");
    expect(confirm.mock.calls[0][0]).toContain("无法撤销");
    expect(screen.getByText("这是已保存的结果。")).toBeVisible();
    expect(mock.mock.calls.some(([, init]) => init?.method)).toBe(false);
  });

  it("确认删除当前记录清除结果和已保存选择，但保留论文、表单和发送同意", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const mock = mockApi({ papers: [paper, newPaper], jobs: [job], extra: (url, init) => {
      if (url.endsWith("/analyses/job-1") && init?.method === "DELETE") return response({ deleted_id: job.id });
    } });
    window.localStorage.setItem("paper-reader-job", job.id);
    render(<LocalReader />);
    await screen.findByText("这是已保存的结果。");
    await user.selectOptions(screen.getByRole("combobox", { name: "当前论文" }), newPaper.id);
    await user.type(screen.getByRole("textbox", { name: /要分析的具体结果/ }), "Theorem 13.2");
    await user.type(screen.getByRole("textbox", { name: /还想弄清什么/ }), "解释证明");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /^删除记录：Proposition 4.1/ }));
    expect(await screen.findByText(/已删除“Proposition 4.1”的阅读记录/)).toBeVisible();
    expect(screen.queryByRole("region", { name: "当前分析任务" })).toBeNull();
    expect(screen.queryByText("这是已保存的结果。")).toBeNull();
    expect(screen.queryByRole("button", { name: /^删除记录：/ })).toBeNull();
    expect(window.localStorage.getItem("paper-reader-job")).toBeNull();
    expect(window.localStorage.getItem("paper-reader-paper")).toBe(newPaper.id);
    expect(screen.getByRole("combobox", { name: "当前论文" })).toHaveValue(newPaper.id);
    expect(screen.getByRole("option", { name: "paper.pdf（12 页）" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开原论文（新标签页）" })).toHaveAttribute("href", "/api/local/papers/paper-2/pdf");
    expect(screen.getByRole("textbox", { name: /要分析的具体结果/ })).toHaveValue("Theorem 13.2");
    expect(screen.getByRole("textbox", { name: /还想弄清什么/ })).toHaveValue("解释证明");
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(mock.mock.calls.filter(([, init]) => init?.method)).toEqual([
      ["/api/local/analyses/job-1", expect.objectContaining({ method: "DELETE" })],
    ]);
  });

  it("删除非当前记录不切换当前结果，删除请求期间也保留用户新选择", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let finishDelete!: (value: Response) => void;
    const other = { ...job, id: "job-2", target: "Lemma 2", result: { ...result, title: "引理 2" } };
    const mock = mockApi({ jobs: [job, other], extra: (url, init) => {
      if (url.endsWith("/analyses/job-1") && init?.method === "DELETE") return new Promise((resolve) => { finishDelete = resolve; });
    } });
    render(<LocalReader />);
    await screen.findByText("这是已保存的结果。");
    await user.click(screen.getByRole("button", { name: /^删除记录：Proposition 4.1/ }));
    const deletingButton = screen.getByRole("button", { name: /^删除记录：Proposition 4.1/ });
    expect(deletingButton).toHaveTextContent("正在删除…");
    expect(deletingButton).toBeDisabled();
    expect(screen.getByRole("button", { name: /^删除记录：Lemma 2/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /^Lemma 2/ }));
    await act(async () => finishDelete(response({ deleted_id: job.id })));
    expect(screen.getByRole("heading", { name: "引理 2" })).toBeVisible();
    expect(window.localStorage.getItem("paper-reader-job")).toBe(other.id);
    expect(screen.getByRole("button", { name: /^Lemma 2/ })).toHaveAttribute("aria-pressed", "true");
    expect(mock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
    expect(mock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it.each([409, 500])("删除返回 HTTP %s 时保留记录与结果，显示原因并可重试", async (statusCode) => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockApi({ jobs: [job], extra: (url, init) => {
      if (url.endsWith("/analyses/job-1") && init?.method === "DELETE") return response({ detail: "暂时无法删除，请稍后重试" }, false, statusCode);
    } });
    window.localStorage.setItem("paper-reader-job", job.id);
    render(<LocalReader />);
    await screen.findByText("这是已保存的结果。");
    await user.click(screen.getByRole("button", { name: /^删除记录：Proposition 4.1/ }));
    const history = screen.getByRole("complementary", { name: "本机阅读记录" });
    expect(await within(history).findByRole("alert")).toHaveTextContent("删除未完成：暂时无法删除，请稍后重试");
    expect(screen.getByText("这是已保存的结果。")).toBeVisible();
    expect(screen.getByRole("button", { name: /^删除记录：Proposition 4.1/ })).toBeEnabled();
    expect(window.localStorage.getItem("paper-reader-job")).toBe(job.id);
  });

  it.each(["queued", "running"] as const)("%s 记录禁止删除，但可删除另一条旧记录，不会取消或重新分析", async (status) => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const pending = { ...job, id: "job-2", target: "Lemma 2", status, result: null };
    const mock = mockApi({ jobs: [pending, job], extra: (url, init) => {
      if (url.endsWith("/analyses/job-2")) return response(pending);
      if (url.endsWith("/analyses/job-1") && init?.method === "DELETE") return response({ deleted_id: job.id });
    } });
    render(<LocalReader />);
    await screen.findByRole("button", { name: "取消分析" });
    expect(screen.getByRole("button", { name: /^删除记录：Lemma 2/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /^删除记录：Lemma 2/ }));
    expect(confirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /^删除记录：Proposition 4.1/ }));
    await screen.findByText(/已删除“Proposition 4.1”的阅读记录/);
    expect(screen.getByRole("button", { name: "取消分析" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^Lemma 2/ })).toHaveAttribute("aria-pressed", "true");
    expect(mock.mock.calls.filter(([, init]) => init?.method)).toEqual([
      ["/api/local/analyses/job-1", expect.objectContaining({ method: "DELETE" })],
    ]);
  });

  it("较早的刷新响应不会恢复已删除的记录或选择", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let reads = 0;
    let finishRefresh!: (value: Response) => void;
    mockApi({ jobs: [job], extra: (url, init) => {
      if (url.endsWith("/analyses") && !init?.method && ++reads > 1) return new Promise((resolve) => { finishRefresh = resolve; });
      if (url.endsWith("/analyses/job-1") && init?.method === "DELETE") return response({ deleted_id: job.id });
    } });
    window.localStorage.setItem("paper-reader-job", job.id);
    render(<LocalReader />);
    await screen.findByText("这是已保存的结果。");
    await user.click(screen.getByRole("button", { name: "刷新记录" }));
    await user.click(screen.getByRole("button", { name: /^删除记录：Proposition 4.1/ }));
    await screen.findByText(/已删除“Proposition 4.1”的阅读记录/);
    await act(async () => finishRefresh(response([job])));
    expect(screen.queryByRole("button", { name: /^Proposition 4.1/ })).toBeNull();
    expect(screen.queryByRole("region", { name: "当前分析任务" })).toBeNull();
    expect(window.localStorage.getItem("paper-reader-job")).toBeNull();
  });

  it("已完成但仍在读取结果的记录删除后，迟到的详情不能恢复记录", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let finishPoll!: (value: Response) => void;
    mockApi({ jobs: [{ ...job, result: null }], extra: (url, init) => {
      if (url.endsWith("/analyses/job-1")) {
        if (init?.method === "DELETE") return response({ deleted_id: job.id });
        return new Promise((resolve) => { finishPoll = resolve; });
      }
    } });
    render(<LocalReader />);
    await screen.findByRole("button", { name: /^删除记录：Proposition 4.1/ });
    await waitFor(() => expect(finishPoll).toBeDefined());
    await user.click(screen.getByRole("button", { name: /^删除记录：Proposition 4.1/ }));
    await screen.findByText(/已删除“Proposition 4.1”的阅读记录/);
    await act(async () => finishPoll(response(job)));
    expect(screen.queryByRole("button", { name: /^Proposition 4.1/ })).toBeNull();
    expect(screen.queryByText("这是已保存的结果。")).toBeNull();
  });

  it("删除当前记录后不再显示属于该记录的进度读取错误", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockApi({ jobs: [{ ...job, result: null }], extra: (url, init) => {
      if (url.endsWith("/analyses/job-1")) return init?.method === "DELETE"
        ? response({ deleted_id: job.id }) : response({ detail: "读取结果失败" }, false, 503);
    } });
    render(<LocalReader />);
    await screen.findByText(/暂时无法获取分析状态/);
    await user.click(screen.getByRole("button", { name: /^删除记录：Proposition 4.1/ }));
    await screen.findByText(/已删除“Proposition 4.1”的阅读记录/);
    expect(screen.queryByText(/暂时无法获取分析状态/)).toBeNull();
    expect(screen.queryByRole("button", { name: "重新获取进度" })).toBeNull();
  });

  it("刷新同步另一页面已删除的记录，清除选择与结果但保留 PDF", async () => {
    const user = userEvent.setup();
    let reads = 0;
    const mock = mockApi({ extra: (url, init) => {
      if (url.endsWith("/analyses") && !init?.method) return response(++reads === 1 ? [job] : []);
    } });
    window.localStorage.setItem("paper-reader-job", job.id);
    render(<LocalReader />);
    await screen.findByText("这是已保存的结果。");
    await user.click(screen.getByRole("button", { name: "刷新记录" }));
    await screen.findByText(/还没有分析记录/);
    expect(screen.queryByRole("region", { name: "当前分析任务" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^删除记录：/ })).toBeNull();
    expect(window.localStorage.getItem("paper-reader-job")).toBeNull();
    expect(screen.getByRole("combobox", { name: "当前论文" })).toHaveValue(paper.id);
    expect(screen.getByRole("link", { name: "打开原论文（新标签页）" })).toBeVisible();
    expect(mock.mock.calls.some(([, init]) => init?.method)).toBe(false);
  });

  it("删除响应丢失后可刷新同步服务器实际删除状态，不再次发送删除或分析", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let serverDeleted = false;
    const mock = mockApi({ extra: (url, init) => {
      if (url.endsWith("/analyses") && !init?.method) return response(serverDeleted ? [] : [job]);
      if (url.endsWith("/analyses/job-1") && init?.method === "DELETE") {
        serverDeleted = true;
        return Promise.reject(new TypeError("Connection lost after deletion"));
      }
    } });
    window.localStorage.setItem("paper-reader-job", job.id);
    render(<LocalReader />);
    await screen.findByText("这是已保存的结果。");
    await user.click(screen.getByRole("button", { name: /^删除记录：Proposition 4.1/ }));
    await screen.findByText(/删除未完成/);
    expect(screen.getByText("这是已保存的结果。")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "刷新记录" }));
    await screen.findByText(/还没有分析记录/);
    expect(screen.queryByRole("region", { name: "当前分析任务" })).toBeNull();
    expect(window.localStorage.getItem("paper-reader-job")).toBeNull();
    expect(screen.queryByText(/删除未完成/)).toBeNull();
    expect(mock.mock.calls.filter(([, init]) => init?.method)).toEqual([
      ["/api/local/analyses/job-1", expect.objectContaining({ method: "DELETE" })],
    ]);
  });
});

describe("reconcileJobs", () => {
  it("刷新响应删除旧记录但保留请求发出后新建的任务", () => {
    const created = { ...job, id: "new-job", status: "queued" as const, result: null };
    expect(reconcileJobs([created, job], [], new Set([job.id]), new Set())).toEqual([created]);
  });

  it("刷新中的较旧状态不会覆盖更新的轮询结果，也不能恢复已删除记录", () => {
    const completed = { ...job, updated_at: "2026-09-20T00:02:00Z" };
    const stale = { ...job, status: "running" as const, result: null };
    const deleted = { ...job, id: "deleted-job" };
    const reconciled = reconcileJobs([completed], [stale, deleted], new Set([job.id, deleted.id]), new Set([deleted.id]));
    expect(reconciled).toEqual([completed]);
  });
});
