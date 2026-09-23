# 本地 AI 阅读流程：接口约定

浏览器使用同源 `/api/local/*`，Next.js 服务端代理到 FastAPI `/api/*`。后端地址不由浏览器提供。所有服务只绑定 127.0.0.1。

## 接口

- `GET /api/codex/status` → `{ installed, authenticated, auth_method: "chatgpt" | "api_key" | "none", version, message }`
- `GET /api/papers` → `Paper[]`
- `POST /api/papers`（multipart 字段 `file`）→ `Paper`，只导入本地，不自动开始 AI。
- `GET /api/papers/{id}/pdf` → PDF
- `GET /api/papers/{id}/pages/{page}` → `{ page, text }`
- `GET /api/analyses` → `AnalysisJob[]`
- `POST /api/analyses` → `AnalysisJob`，请求 `{ paper_id, target, instructions, processing_consent: true }`
- `GET /api/analyses/{id}` → `AnalysisJob`
- `POST /api/analyses/{id}/cancel` → `AnalysisJob`

`Paper = { id, title, filename, page_count, created_at, text_available, warnings: string[] }`

`AnalysisJob = { id, paper_id, target, instructions, status: "queued" | "running" | "completed" | "failed" | "cancelled", stage, created_at, updated_at, error: string | null, result: AnalysisResult | null }`

## 分析数据

`Source = { pages: number[], evidence: string, inferred: boolean }`（PDF 页码从 1 开始）

`Block = { kind: "paragraph" | "formula", text: string, source: Source }`

`Section = { title: string, blocks: Block[] }`

`AnalysisResult = { title: string, target_found: boolean, statement: Block[], intuitive_explanation: Block[], symbols: { symbol: string, meaning: string, explanation: string, source: Source }[], proof: { goal: Block[], strategy: Block[], sections: Section[] }, relations: { target: string, statement: Block[], explanation: Block[] }[], importance: Section[], limitations: string[] }`

数学段落中的行内公式使用 `\\(…\\)`；独立公式块的 `text` 是不带分隔符的 LaTeX。正文为中文；原文引用保持原语言。前端不渲染原始 HTML。

## 行为

导入、结果持久化在项目 `.local/`，不加入版本控制。单进程、单个 AI 任务并发；忙时明确拒绝新任务，不虚构进度百分比。重启后的未完成任务标记失败。未找到指定结论时 `target_found=false`，明确提示，不用另一条结论代替。扫描件/不可读 PDF 不发起 AI。输出结构与出处页码必须验证；推断与原文明确区分。原始 benchmark 保留在 `/example`，已有 `/?tab=...` 链接保持兼容。

用户必须明确勾选：论文提取文本会通过本机 Codex 发送到 OpenAI，使用自己的 ChatGPT/Codex 配额；本地部署不等于离线推理。禁止读取/复制 auth.json、token、浏览器登录 cookie；只通过 Codex CLI 复用登录。子进程用参数数组、不使用 shell；关闭命令执行、MCP、插件、hooks、网页搜索和子代理等不必要工具。无 API Key 输入框，也不回退到 API Key。
