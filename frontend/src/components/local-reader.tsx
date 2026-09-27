"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import styles from "@/app/local-reader.module.css";
import type { AnalysisJob, CodexStatus, LocalPaper } from "@/types/local-analysis";

import { LocalAnalysisResult } from "./local-analysis-result";

const apiRoot = "/api/local";
const statusLabels: Record<AnalysisJob["status"], string> = {
  queued: "等待分析", running: "分析中", completed: "已完成", failed: "分析失败", cancelled: "已取消",
};

function isPending(job: AnalysisJob) {
  return job.status === "queued" || job.status === "running";
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "请求失败，请检查本地服务后重试。";
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiRoot}${path}`, { ...init, cache: "no-store" });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Error("无法连接本地服务。请确认项目已启动，再刷新重试。");
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error(`本地服务未返回可读取的数据（HTTP ${response.status}）。请检查终端日志。`);
  }
  if (!response.ok) {
    const detail = data && typeof data === "object" && "detail" in data ? data.detail : null;
    throw new Error(typeof detail === "string" ? detail : `请求未成功（HTTP ${response.status}），请检查输入或稍后重试。`);
  }
  return data as T;
}

function savedValue(key: string) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function saveValue(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* Storage may be unavailable; server history still works. */ }
}

function removeSavedValue(key: string) {
  try { window.localStorage.removeItem(key); } catch { /* Server history deletion does not depend on browser storage. */ }
}

function readableTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function mergeJob(jobs: AnalysisJob[], next: AnalysisJob) {
  const existing = jobs.find((job) => job.id === next.id);
  if (existing && existing.updated_at > next.updated_at) return jobs;
  return existing ? jobs.map((job) => job.id === next.id ? next : job) : [next, ...jobs];
}

export function reconcileJobs(current: AnalysisJob[], incoming: AnalysisJob[], idsAtRequestStart: ReadonlySet<string>, deleted: ReadonlySet<string>) {
  const incomingIds = new Set(incoming.map((job) => job.id));
  // An absent server record is deleted, unless it was only added locally after
  // this request began. Keep newer poll responses for records still on server.
  const retained = current.filter((job) => !deleted.has(job.id) && (!idsAtRequestStart.has(job.id) || incomingIds.has(job.id)));
  return incoming.filter((job) => !deleted.has(job.id)).reduce(mergeJob, retained);
}

export function LocalReader() {
  const [status, setStatus] = useState<CodexStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [statusError, setStatusError] = useState("");
  const [papers, setPapers] = useState<LocalPaper[]>([]);
  const [jobs, setJobs] = useState<AnalysisJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [libraryReady, setLibraryReady] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const [paperId, setPaperId] = useState("");
  const [jobId, setJobId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [importMode, setImportMode] = useState<"file" | "arxiv">("file");
  const [arxivReference, setArxivReference] = useState("");
  const [target, setTarget] = useState("");
  const [instructions, setInstructions] = useState("");
  const [consent, setConsent] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [historyNotice, setHistoryNotice] = useState("");
  const [formError, setFormError] = useState("");
  const [jobError, setJobError] = useState("");
  const [pollError, setPollError] = useState("");
  const [pollVersion, setPollVersion] = useState(0);
  const [notice, setNotice] = useState("");
  const statusSequence = useRef(0);
  const librarySequence = useRef(0);
  const currentJobs = useRef<AnalysisJob[]>([]);
  // List/detail requests that started before deletion must not restore it.
  const deletedIds = useRef(new Set<string>());
  const deletionInFlight = useRef("");
  const mounted = useRef(false);
  const requests = useRef(new Set<AbortController>());
  const fileInput = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const resultRef = useRef<HTMLElement>(null);

  const updateJobs = useCallback((update: (current: AnalysisJob[]) => AnalysisJob[]) => {
    const next = update(currentJobs.current);
    currentJobs.current = next;
    setJobs(next);
    return next;
  }, []);

  const request = useCallback(async <T,>(path: string, init?: RequestInit) => {
    const controller = new AbortController();
    requests.current.add(controller);
    try { return await api<T>(path, { ...init, signal: controller.signal }); }
    finally { requests.current.delete(controller); }
  }, []);

  const loadStatus = useCallback(async () => {
    const sequence = ++statusSequence.current;
    try {
      const next = await request<CodexStatus>("/codex/status");
      if (!mounted.current || sequence !== statusSequence.current) return;
      setStatus(next);
      setStatusError("");
    } catch (error) {
      if (!mounted.current || sequence !== statusSequence.current) return;
      setStatus(null);
      setStatusError(messageFrom(error));
    } finally {
      if (mounted.current && sequence === statusSequence.current) setChecking(false);
    }
  }, [request]);

  const loadLibrary = useCallback(async () => {
    const sequence = ++librarySequence.current;
    const idsAtRequestStart = new Set(currentJobs.current.map((job) => job.id));
    try {
      const [nextPapers, nextJobs] = await Promise.all([request<LocalPaper[]>("/papers"), request<AnalysisJob[]>("/analyses")]);
      if (!mounted.current || sequence !== librarySequence.current) return;
      const reconciled = updateJobs((current) => reconcileJobs(current, nextJobs, idsAtRequestStart, deletedIds.current));
      for (const id of idsAtRequestStart) {
        if (!reconciled.some((job) => job.id === id)) deletedIds.current.add(id);
      }
      setConsent(false);
      setPapers(nextPapers);
      setPaperId((current) => nextPapers.some((paper) => paper.id === current) ? current
        : nextPapers.find((paper) => paper.id === savedValue("paper-reader-paper"))?.id ?? nextPapers[0]?.id ?? "");
      const savedJobId = savedValue("paper-reader-job");
      if (savedJobId && !reconciled.some((job) => job.id === savedJobId)) removeSavedValue("paper-reader-job");
      setJobId((current) => current ? (reconciled.some((job) => job.id === current) ? current : "")
        : reconciled.find((job) => job.id === savedJobId)?.id
          ?? nextJobs.find((job) => reconciled.some((item) => item.id === job.id))?.id ?? reconciled[0]?.id ?? "");
      setLibraryReady(true);
      setLibraryError("");
      setHistoryError("");
    } catch (error) {
      if (!mounted.current || sequence !== librarySequence.current) return;
      setLibraryReady(false);
      setLibraryError(messageFrom(error));
    } finally {
      if (mounted.current && sequence === librarySequence.current) setLoading(false);
    }
  }, [request, updateJobs]);

  useEffect(() => {
    mounted.current = true;
    // Both loaders await network responses before setting state; loading state is initialized above.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStatus();
    void loadLibrary();
    const controllers = requests.current;
    return () => {
      mounted.current = false;
      for (const controller of controllers) controller.abort();
      controllers.clear();
    };
  }, [loadStatus, loadLibrary]);

  const paper = papers.find((item) => item.id === paperId);
  const selectedJob = jobs.find((item) => item.id === jobId);
  const pendingJob = jobs.find(isPending);
  // Poll the running task even while an older result is being read.
  const pollId = pendingJob?.id ?? (selectedJob && !selectedJob.result && selectedJob.status === "completed" ? selectedJob.id : "");

  useEffect(() => {
    if (!pollId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    async function poll() {
      try {
        const next = await api<AnalysisJob>(`/analyses/${encodeURIComponent(pollId)}`, { signal: controller.signal });
        if (disposed || deletedIds.current.has(pollId)) return;
        updateJobs((current) => mergeJob(current, next));
        setPollError("");
        if (isPending(next)) timer = setTimeout(poll, 2000);
      } catch (error) {
        if (disposed || deletedIds.current.has(pollId)) return;
        setPollError(`暂时无法获取分析状态：${messageFrom(error)} 不会自动重新提交分析。`);
        // A failed status read is not a failed AI job. User can explicitly reconnect.
      }
    }
    void poll();
    return () => { disposed = true; controller.abort(); if (timer) clearTimeout(timer); };
  }, [pollId, pollVersion, updateJobs]);

  const ready = status?.installed && status.authenticated && status.auth_method === "chatgpt";
  // Neither a chosen file nor a typed arXiv reference is a saved paper yet.
  // Failed imports must never fall back to analyzing the previous paper.
  const pendingImport = !!file || !!arxivReference.trim();
  const canSubmit = ready && libraryReady && paper?.text_available && target.trim() && consent && !pendingImport && !pendingJob && !loading && !submitting && !uploading;

  function chooseFile(next: File | null) {
    setFile(next);
    setConsent(false);
    setFormError("");
    setNotice("");
  }

  function clearPendingImport() {
    setFile(null);
    setArxivReference("");
    if (fileInput.current) fileInput.current.value = "";
    setConsent(false);
    setFormError("");
    setNotice("");
  }

  function chooseImportMode(next: "file" | "arxiv") {
    if (loading || uploading || submitting || next === importMode) return;
    clearPendingImport();
    setImportMode(next);
  }

  function chooseArxivReference(next: string) {
    setArxivReference(next);
    setConsent(false);
    setFormError("");
    setNotice("");
  }

  async function importPaper() {
    if (loading || uploading || submitting) return;
    const reference = arxivReference.trim();
    if (importMode === "arxiv" ? !reference : !file) return;
    if (importMode === "file" && file && !file.name.toLowerCase().endsWith(".pdf")) {
      setFormError("请选择 PDF 文件。");
      return;
    }
    setUploading(true);
    setFormError("");
    setNotice("");
    try {
      let imported: LocalPaper;
      if (importMode === "arxiv") {
        imported = await request<LocalPaper>("/papers/arxiv", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reference }),
        });
      } else {
        const data = new FormData();
        data.append("file", file!);
        imported = await request<LocalPaper>("/papers", { method: "POST", body: data });
      }
      if (!mounted.current) return;
      setPapers((current) => [imported, ...current.filter((item) => item.id !== imported.id)]);
      setPaperId(imported.id);
      saveValue("paper-reader-paper", imported.id);
      setConsent(false);
      setFile(null);
      setArxivReference("");
      if (fileInput.current) fileInput.current.value = "";
      setNotice(`已导入 ${imported.filename}，共 ${imported.page_count} 页。导入不会自动调用 AI。`);
    } catch (error) { if (mounted.current) setFormError(messageFrom(error)); }
    finally { if (mounted.current) setUploading(false); }
  }

  async function startAnalysis(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setFormError("");
    setNotice("");
    try {
      const next = await request<AnalysisJob>("/analyses", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paper_id: paperId, target: target.trim(), instructions: instructions.trim(), processing_consent: true }),
      });
      if (!mounted.current) return;
      updateJobs((current) => mergeJob(current, next));
      setJobId(next.id);
      saveValue("paper-reader-job", next.id);
      setConsent(false);
      setPollError("");
      setJobError("");
      setNotice("分析已提交。可以阅读已有结果，也可以稍后刷新页面查看进度。");
    } catch (error) {
      if (!mounted.current) return;
      setFormError(`${messageFrom(error)} 如不确定是否已提交，请先刷新历史记录，避免重复调用。`);
      void loadLibrary();
    } finally { if (mounted.current) setSubmitting(false); }
  }

  async function cancelAnalysis(job: AnalysisJob) {
    if (cancelling) return;
    setCancelling(true);
    setJobError("");
    try {
      const next = await request<AnalysisJob>(`/analyses/${encodeURIComponent(job.id)}/cancel`, { method: "POST" });
      if (!mounted.current || deletedIds.current.has(job.id)) return;
      updateJobs((current) => mergeJob(current, next));
      setPollError("");
    } catch (error) { if (mounted.current) setJobError(messageFrom(error)); }
    finally { if (mounted.current) setCancelling(false); }
  }

  async function deleteJob(job: AnalysisJob) {
    if (deletionInFlight.current || deletedIds.current.has(job.id)) return;
    if (isPending(job)) {
      setHistoryError("正在分析或等待中的记录不能删除。请先取消分析，待任务停止后再删除。");
      return;
    }
    const filename = papers.find((item) => item.id === job.paper_id)?.filename ?? "已导入论文";
    if (!window.confirm(`删除阅读记录“${job.target}”？\n论文：${filename}\n\n将删除这条记录及其分析结果，已导入的 PDF 会保留。此操作无法撤销。`)) return;
    deletionInFlight.current = job.id;
    setDeletingId(job.id);
    setHistoryError("");
    setHistoryNotice("");
    try {
      await request<{ deleted_id: string }>(`/analyses/${encodeURIComponent(job.id)}`, { method: "DELETE" });
      if (!mounted.current) return;
      deletedIds.current.add(job.id);
      updateJobs((current) => current.filter((item) => item.id !== job.id));
      setJobId((current) => current === job.id ? "" : current);
      if (savedValue("paper-reader-job") === job.id) removeSavedValue("paper-reader-job");
      setHistoryNotice(`已删除“${job.target}”的阅读记录及分析结果；已导入的 PDF 已保留。`);
    } catch (error) {
      if (mounted.current) setHistoryError(`删除未完成：${messageFrom(error)}`);
    } finally {
      deletionInFlight.current = "";
      if (mounted.current) setDeletingId("");
    }
  }

  function selectJob(job: AnalysisJob) {
    if (deletedIds.current.has(job.id)) return;
    setJobId(job.id);
    setJobError("");
    saveValue("paper-reader-job", job.id);
    resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function prepareRetry(job: AnalysisJob) {
    if (loading || uploading || submitting) return;
    clearPendingImport();
    const retryPaper = papers.find((item) => item.id === job.paper_id);
    if (!retryPaper) {
      setPaperId("");
      setFormError("这条记录对应的论文已不在本机论文库中，请重新导入；不会改用其他论文。");
      return;
    }
    setPaperId(job.paper_id);
    saveValue("paper-reader-paper", job.paper_id);
    setTarget(job.target);
    setInstructions(job.instructions);
    setConsent(false);
    setNotice(`已恢复历史任务的论文：${retryPaper.filename}，并填回原问题。待导入的文件或 arXiv 输入已清除。请检查内容，重新勾选同意后点击“开始分析”；目前没有发送新任务。`);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    document.getElementById("analysis-target")?.focus();
  }

  function downloadResult(job: AnalysisJob) {
    if (!job.result) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(job.result, null, 2)], { type: "application/json;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `paper-analysis-${job.id}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}><h1>PaperREADed</h1><a href="/example">阅读示例：命题 4.1</a></header>
      <main className={styles.main}>
        <section aria-label="本机 Codex 连接">
          <div className={styles.connection}>
            <strong className={ready ? styles.ready : undefined}>{checking ? "正在检查本机 Codex…" : ready ? "已检测到本机 Codex · ChatGPT 已登录" : "需要本机 Codex 的 ChatGPT 登录"}</strong>
            <button type="button" className={styles.textButton} disabled={checking} onClick={() => { setChecking(true); void loadStatus(); }}>刷新登录状态</button>
          </div>
          <p className={styles.small}>在自己的电脑上启动、通过浏览器阅读；AI 通过本机 Codex 联网工作，不是离线模型，也无需在项目中填写 API Key。</p>
          {ready && <p className={styles.small}>这里只检查安装与登录状态，不代表 AI 分析已运行成功。请从 Mac 普通 Terminal 启动项目；若执行环境受限，分析仍可能失败。</p>}
          {statusError && <p className={styles.error} role="alert">{statusError}</p>}
          {!checking && !ready && <div className={styles.setup}>
            <p>{status?.message || "请先准备好 Node.js、Python 与 Codex CLI，并按项目 README 启动服务。"}</p>
            {status?.auth_method === "api_key" && <p>检测到 API Key 登录，本项目不会使用它。请先在终端执行 <code>codex logout</code>，再使用 ChatGPT 登录。</p>}
            <p>在本机终端运行 <code>codex login</code>，在浏览器完成 ChatGPT 登录，再点击“刷新登录状态”。</p>
            <p className={styles.small}>页面不会读取、复制或展示你的登录凭据。</p>
          </div>}
        </section>

        <div className={styles.workspace}>
          <form ref={formRef} className={styles.form} onSubmit={startAnalysis} aria-label="导入论文并指定结论">
            <h2>导入论文，说明要读哪个结论</h2>
            <fieldset className={styles.importModes} disabled={loading || uploading || submitting} aria-describedby="import-mode-help">
              <legend className={styles.label}>选择导入方式</legend>
              <div className={styles.importOptions}>
                <label className={styles.importOption}><input type="radio" name="import-mode" value="file" checked={importMode === "file"} onChange={() => chooseImportMode("file")} />本地 PDF</label>
                <label className={styles.importOption}><input type="radio" name="import-mode" value="arxiv" checked={importMode === "arxiv"} onChange={() => chooseImportMode("arxiv")} />arXiv 论文</label>
              </div>
            </fieldset>
            <p className={styles.small} id="import-mode-help">切换方式会清空当前文件选择或链接输入；已保存的论文和阅读记录不受影响。</p>
            {importMode === "file" ? <>
              <label className={styles.label} htmlFor="paper-file">导入 PDF</label>
              <div className={styles.upload}>
                <input ref={fileInput} id="paper-file" type="file" accept=".pdf,application/pdf" disabled={loading || uploading || submitting} onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} />
                <button className={styles.button} type="button" disabled={!file || loading || uploading || submitting} onClick={() => void importPaper()}>{uploading ? "正在导入…" : "导入到本机"}</button>
              </div>
              <p className={styles.small}>导入只保存在本机；点击“开始分析”并同意后才发送提取文本。</p>
            </> : <>
              <label className={styles.label} htmlFor="arxiv-reference">arXiv 链接或编号</label>
              <div className={styles.arxivImport}>
                <input className={styles.input} id="arxiv-reference" value={arxivReference} maxLength={500} autoCapitalize="none" autoComplete="off" spellCheck={false} aria-describedby="arxiv-help" placeholder="https://arxiv.org/pdf/2309.07041" disabled={loading || uploading || submitting} onChange={(event) => chooseArxivReference(event.target.value)} />
                <button className={styles.button} type="button" disabled={!arxivReference.trim() || loading || uploading || submitting} onClick={() => void importPaper()}>{uploading ? "正在下载并导入…" : "下载并导入"}</button>
              </div>
              <p className={styles.small} id="arxiv-help">支持 arXiv 的 PDF 链接、摘要链接或论文编号（如 2309.07041）。点击后会联网从 arXiv 下载 PDF 并保存在本机，不会调用 AI；开始分析仍需另行同意。</p>
            </>}
            {pendingImport && <div className={styles.pendingImport} role="status">
              <strong>{uploading ? "正在导入：" : "尚未导入："}{file?.name ?? arxivReference.trim()}</strong>
              <p>{uploading ? "请等待导入完成，再确认论文并开始分析。" : `请点击“${importMode === "file" ? "导入到本机" : "下载并导入"}”。导入成功前不能开始分析，也不会沿用之前的论文。`}</p>
              <button type="button" className={styles.textButton} disabled={uploading || submitting} onClick={clearPendingImport}>{importMode === "file" ? "取消选择" : "取消输入"}</button>
            </div>}
            <label className={styles.label} htmlFor="paper-select">当前论文</label>
            <select className={styles.input} id="paper-select" value={pendingImport ? "" : paperId} disabled={pendingImport || loading || uploading || submitting || !papers.length} onChange={(event) => { setPaperId(event.target.value); setConsent(false); setNotice(""); setFormError(""); saveValue("paper-reader-paper", event.target.value); }}>
              <option value="" disabled>{loading ? "正在读取论文列表…" : pendingImport ? "请先完成上方的论文导入" : papers.length ? "请选择已导入的论文" : "请先导入一篇论文"}</option>
              {papers.map((item) => <option key={item.id} value={item.id}>{item.filename}（{item.page_count} 页）</option>)}
            </select>
            {!pendingImport && paper && <p className={styles.small}><a href={`${apiRoot}/papers/${encodeURIComponent(paper.id)}/pdf`} target="_blank" rel="noreferrer">打开原论文（新标签页）</a></p>}
            {!pendingImport && paper?.warnings.map((warning, index) => <p className={styles.warning} key={index}>{warning}</p>)}
            {!pendingImport && paper && !paper.text_available && <p className={styles.warning} role="alert">这份 PDF 没有足够的可读取文本，可能是扫描件。请先在本机进行 OCR 后重新导入，当前不会发起 AI 分析。</p>}
            <label className={styles.label} htmlFor="analysis-target">要分析的具体结果 <span className={styles.muted}>（必填）</span></label>
            <input className={styles.input} id="analysis-target" value={target} required maxLength={2000} disabled={submitting} placeholder="例如：Proposition 4.1，PDF 第 13 页" onChange={(event) => { setTarget(event.target.value); setConsent(false); }} />
            <label className={styles.label} htmlFor="analysis-instructions">还想弄清什么 <span className={styles.muted}>（可选）</span></label>
            <textarea className={styles.input} id="analysis-instructions" value={instructions} disabled={submitting} maxLength={10000} placeholder="例如：先写清引用的方程，再解释为什么引入这个模空间；说明每一步依赖什么。" onChange={(event) => { setInstructions(event.target.value); setConsent(false); }} />
            {!pendingImport && paper && <p className={styles.analysisSubject}>本次分析的论文：<strong>{paper.filename}</strong></p>}
            <label className={styles.consent}>
              <input type="checkbox" checked={consent} disabled={pendingImport || uploading || submitting} onChange={(event) => setConsent(event.target.checked)} />
              <span>我同意将论文提取文本和上述问题通过本机 Codex 发送给 OpenAI，使用我自己的 ChatGPT / Codex 配额。本机运行不等于离线分析。</span>
            </label>
            <div className={styles.formActions}><button className={`${styles.button} ${styles.primary}`} type="submit" disabled={!canSubmit}>{submitting ? "正在提交…" : "开始分析"}</button></div>
            {pendingJob && <p className={styles.small}>已有一个任务正在分析；完成或取消后才能开始新的任务。<button type="button" className={styles.textButton} onClick={() => selectJob(pendingJob)}>查看当前任务</button></p>}
            {!ready && !checking && <p className={styles.small}>完成 ChatGPT 登录后即可开始；你仍可以导入论文或阅读历史结果。</p>}
            {formError && <p className={styles.error} role="alert">{formError}</p>}
            {notice && <p className={styles.small} role="status">{notice}</p>}
          </form>

          <aside className={styles.history} aria-label="本机阅读记录">
            <div className={styles.historyHeading}><h2>阅读记录</h2><button type="button" className={styles.textButton} disabled={loading || uploading || submitting} onClick={() => { setLoading(true); setConsent(false); void loadLibrary(); }}>刷新记录</button></div>
            <p className={styles.small}>论文与结果保存在本机，刷新页面后可以继续阅读。</p>
            {libraryError && <p className={styles.error} role="alert">{libraryError}</p>}
            {historyError && <p className={styles.error} role="alert">{historyError}</p>}
            {historyNotice && <p className={styles.small} role="status">{historyNotice}</p>}
            {!jobs.length && <p className={styles.empty}>{loading ? "正在读取…" : "还没有分析记录。可以先阅读命题 4.1 示例，或导入自己的论文。"}</p>}
            <ul className={styles.historyList}>
              {jobs.map((job) => <li key={job.id}><button type="button" className={styles.historyButton} aria-pressed={job.id === jobId} onClick={() => selectJob(job)}>
                <strong>{job.target}</strong><span>{papers.find((item) => item.id === job.paper_id)?.filename ?? "已导入论文"}</span><span>{statusLabels[job.status]} · {readableTime(job.created_at)}</span>
              </button><div className={styles.historyActions}>
                <button type="button" className={`${styles.textButton} ${styles.deleteButton}`} disabled={isPending(job) || !!deletingId}
                  aria-label={`删除记录：${job.target}（${papers.find((item) => item.id === job.paper_id)?.filename ?? "已导入论文"}）`}
                  onClick={() => void deleteJob(job)}>{deletingId === job.id ? "正在删除…" : "删除记录"}</button>
                {isPending(job) && <span className={styles.small}>请先取消分析再删除</span>}
              </div></li>)}
            </ul>
          </aside>
        </div>

        {pollId && pollError && <div className={styles.error} role="alert">{pollError} <button type="button" className={styles.textButton} onClick={() => setPollVersion((version) => version + 1)}>重新获取进度</button></div>}
        {selectedJob && <section ref={resultRef} className={styles.job} aria-label="当前分析任务">
          <div className={styles.jobHeading}>
            <p>{statusLabels[selectedJob.status]} · {selectedJob.target} · {papers.find((item) => item.id === selectedJob.paper_id)?.filename ?? "已导入论文"}</p>
            <div className={styles.jobActions}>
              {isPending(selectedJob) && <button type="button" className={styles.textButton} disabled={cancelling} onClick={() => void cancelAnalysis(selectedJob)}>{cancelling ? "正在取消…" : "取消分析"}</button>}
              {(selectedJob.status === "failed" || selectedJob.status === "cancelled") && <button type="button" className={styles.textButton} disabled={loading || uploading || submitting} onClick={() => prepareRetry(selectedJob)}>修改问题并重新分析</button>}
              {selectedJob.result && <button type="button" className={styles.textButton} onClick={() => downloadResult(selectedJob)}>下载分析 JSON</button>}
            </div>
          </div>
          {(pendingImport || selectedJob.paper_id !== paperId) && <p className={styles.small}>这里显示的是历史任务，不是上方所选论文的新分析结果。选择或导入新论文不会自动开始分析。</p>}
          {jobError && <p className={styles.error} role="alert">{jobError}</p>}
          {isPending(selectedJob) && <div className={styles.progress} role="status" aria-live="polite"><strong>{selectedJob.stage || statusLabels[selectedJob.status]}</strong><p className={styles.small}>请保持本地服务运行。这里只显示实际阶段，不估算完成百分比；关闭或刷新浏览器不会重新提交任务。</p></div>}
          {selectedJob.status === "failed" && <p className={styles.error} role="alert">{selectedJob.error || "分析没有完成，请检查本机 Codex 登录、配额和终端日志后重试。"}</p>}
          {selectedJob.status === "cancelled" && <p className={styles.small}>任务已取消。此前已发送的文本无法撤回，已产生的用量可能仍计入你的配额。</p>}
          {selectedJob.result && <LocalAnalysisResult key={selectedJob.id} result={selectedJob.result} paperId={selectedJob.paper_id} />}
        </section>}
      </main>
    </div>
  );
}
