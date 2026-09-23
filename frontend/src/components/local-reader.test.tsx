import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AnalysisJob, AnalysisResult, CodexStatus, LocalPaper } from "@/types/local-analysis";
import { LocalReader } from "./local-reader";

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
  afterEach(() => { vi.unstubAllGlobals(); window.localStorage.clear(); });

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
    await user.click(await within(history).findByRole("button", { name: /Proposition 4.1/ }));
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
});
