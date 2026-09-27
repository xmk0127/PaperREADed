# 本地 AI 阅读流程：接口约定

浏览器使用同源 `/api/local/*`，Next.js 服务端代理到 FastAPI `/api/*`。后端地址不由浏览器提供。所有服务只绑定 127.0.0.1。

## 接口

- `GET /api/codex/status` → `{ installed, authenticated, auth_method: "chatgpt" | "api_key" | "none", version, message }`
- `GET /api/papers` → `Paper[]`
- `POST /api/papers`（multipart 字段 `file`）→ `Paper`，只导入本地，不自动开始 AI。
- `POST /api/papers/arxiv`（JSON `{ reference: string }`）→ `Paper`（201）；从固定 arXiv PDF 地址下载并导入本机，不自动开始 AI。接受 arXiv 编号或官方 `/abs/`、`/pdf/` 链接；不允许任意 URL 抓取。校验失败、下载失败或 PDF 解析失败时不创建论文或分析任务。
- `GET /api/papers/{id}/pdf` → PDF
- `GET /api/papers/{id}/pages/{page}` → `{ page, text }`
- `GET /api/analyses` → `AnalysisJob[]`
- `POST /api/analyses` → `AnalysisJob`，请求 `{ paper_id, target, instructions, processing_consent: true }`
- `GET /api/analyses/{id}` → `AnalysisJob`
- `POST /api/analyses/{id}/cancel` → `AnalysisJob`
- `DELETE /api/analyses/{id}` → `{ deleted_id: id }`（200）；仅删除已完成、失败或已取消任务的记录、结果与任务工作文件，保留导入的论文。任务仍在等待或运行时返回 409，需先取消或等待完成；不存在或无效的任务 ID 返回 404。

`Paper = { id, title, filename, page_count, created_at, text_available, warnings: string[] }`

`AnalysisJob = { id, paper_id, target, instructions, status: "queued" | "running" | "completed" | "failed" | "cancelled", stage, created_at, updated_at, error: string | null, result: AnalysisResult | null }`

## 分析数据

`Source = { pages: number[], evidence: string, inferred: boolean }`（PDF 页码从 1 开始）

`Block = { kind: "paragraph" | "formula", text: string, source: Source }`

`Section = { title: string, blocks: Block[] }`

`AnalysisResult = { title: string, target_found: boolean, statement: Block[], intuitive_explanation: Block[], symbols: { symbol: string, meaning: string, explanation: string, source: Source }[], proof: { goal: Block[], strategy: Block[], sections: Section[] }, relations: { target: string, statement: Block[], explanation: Block[] }[], importance: Section[], limitations: string[] }`

数学段落中的行内公式使用 `\\(…\\)`；独立公式块的 `text` 是不带分隔符的 LaTeX。正文为中文；原文引用保持原语言。前端不渲染原始 HTML。

## 行为

导入方式分为本地 PDF 与 arXiv。arXiv 编号经验证后仅用于构造 `https://arxiv.org/pdf/{id}`，不直接请求用户提供的 URL，不转发 Cookie、Authorization 或本机启动令牌。禁止重定向，下载最大 30 MiB，独立进程下载超过 35 秒即停止；随后仍执行 PDF 解析的 60 秒、250 页和 600,000 字符限制。失败不保存论文或建立分析任务。下载需联网联系 arXiv，但不会因此联系 OpenAI。macOS 默认 CA 库为空时可使用系统证书库，始终保留证书及主机名验证。

仅选择文件或填写链接不算完成导入；待导入及导入失败时不能分析旧论文。成功导入、切换方式或更换论文后均需重新确认发送同意。切换方式清除未导入的选择，不删除已保存数据。

阅读记录支持逐条删除；界面确认后才发送删除请求，不提供批量清空。删除不可撤销，不自动取消运行中的任务，也不发送新的 AI 请求。导入的 PDF 与提取文本保留，其他记录不受影响。删除后刷新页面不会恢复记录；已经发送到 OpenAI 的内容和已经产生的用量不受本机删除影响。

导入、结果持久化在项目 `.local/`，不加入版本控制。单进程、单个 AI 任务并发；忙时明确拒绝新任务，不虚构进度百分比。重启后的未完成任务标记失败。未找到指定结论时 `target_found=false`，明确提示，不用另一条结论代替。扫描件/不可读 PDF 不发起 AI。输出结构与出处页码必须验证；推断与原文明确区分。原始 benchmark 保留在 `/example`，已有 `/?tab=...` 链接保持兼容。

用户必须明确勾选：论文提取文本会通过本机 Codex 发送到 OpenAI，使用自己的 ChatGPT/Codex 配额；本地部署不等于离线推理。禁止读取/复制 auth.json、token、浏览器登录 cookie；只通过 Codex CLI 复用登录。子进程用参数数组、不使用 shell；关闭命令执行、MCP、插件、hooks、网页搜索和子代理等不必要工具。无 API Key 输入框，也不回退到 API Key。
