# PaperREADed

在自己电脑上启动、通过浏览器使用的 **AI 论文重要结论阅读器**。

导入本机 PDF 或指定 arXiv 论文，指定要分析的定理、命题、引理或公式，阅读陈述、符号、证明逻辑、结论关系与作用，并按页码核对原文。PDF 需要带文本层。技术栈：Next.js + TypeScript + KaTeX，Python + FastAPI。

AI 使用**你自己电脑上 Codex CLI 的 ChatGPT 登录状态**，不需要在项目中填写 OpenAI API Key。只有在页面确认并开始分析后，论文提取文本和问题才会通过 Codex 发送到 OpenAI，使用自己的账号权限与配额。**本机运行不等于离线 AI。**

> 当前为预览版本。代码采用 MIT 许可证，署名 xmk0127。自动化测试使用模拟模型响应，真实 AI 端到端尚待在普通终端验收。仓库目前为私有；示例 PDF 不随源码分发。

## 快速开始

支持 macOS、Linux；Windows 请使用 WSL。请在自己电脑的普通终端运行，不要从受限的 agent / 沙箱终端启动真实分析。

### 1. 准备环境并获取代码

- Node.js **24.19.0**（`.nvmrc` 指定版本），支持范围 `>=24.15.0 <25`；同时需要 npm。
- Python **3.9+**，推荐 **3.12**，需要 `venv` 和 pip。
- Git；安装依赖及使用 AI 时需要网络。

仓库地址为 [xmk0127/PaperREADed](https://github.com/xmk0127/PaperREADed)。**目前是私有仓库，只有仓库所有者及获授权的协作者可以克隆**；如果没有权限，请先向所有者申请访问。也可以直接使用所有者提供的源码文件夹。

```bash
git clone https://github.com/xmk0127/PaperREADed.git
cd PaperREADed
```

如果已有项目文件夹，直接进入它即可；现有 `math-paper-reader` 文件夹不必改名。

```bash
# 使用 nvm 的用户先执行：nvm install && nvm use
python3 scripts/project.py setup
```

`setup` 使用 `npm ci` 安装前端锁定依赖，创建 `backend/.venv/`，按 `backend/requirements.lock` 安装后端依赖，再安装项目本身。它不会全局安装 Codex、自动登录、覆盖 `.env` 或复制登录凭据。

### 2. 登录自己的 Codex

需要 Codex CLI **0.155.0+**。首次使用执行：

```bash
npm install -g @openai/codex
codex --version
codex login
codex login status
```

选择 ChatGPT 登录，在浏览器完成官方流程；最后一条命令应显示 `Logged in using ChatGPT`。项目只接受 ChatGPT 登录，不会自动改用 API Key。

即使已在其他 Codex 界面登录，也请在**启动项目的终端**检查 CLI 登录状态。账号密码不在阅读器网页输入；项目不读取或复制 `auth.json`、令牌或 Cookie。参考 [Codex 身份验证](https://learn.chatgpt.com/docs/auth)和[非交互模式](https://learn.chatgpt.com/docs/non-interactive-mode)。

### 3. 诊断并启动

```bash
python3 scripts/project.py doctor
python3 scripts/project.py start
```

`doctor` 检查环境、依赖、Codex 登录和端口，不调用 AI。`start` 构建前端并启动两个服务，看到“已启动”后打开 **[http://127.0.0.1:3100/](http://127.0.0.1:3100/)**。

保持终端打开，Ctrl-C 停止服务；再次使用只需运行 `start`。未登录也能打开界面、导入论文和阅读已保存结果，但不能开始新分析。登录检查成功不等于真实分析一定能启动。

服务仅监听本机：前端 `3100`、后端 `8100`。启动器不杀死占用端口的其他程序、不自动换端口。不需要 `.env`；内部通信令牌临时生成，仅在内存中，不发给浏览器。分别运行 Next.js 和 uvicorn 不会自动配置这套通信。

### 4. 导入论文并说明目标

1. 选择导入方式：**本地 PDF**选择文件后点击“导入到本机”；**arXiv 论文**粘贴链接或编号后点击“下载并导入”，例如 `https://arxiv.org/pdf/2309.07041` 或 `2309.07041`。**只选文件或填链接不等于已导入**。
2. 核对“当前论文”和“本次分析的论文”的文件名、页数及提取提示。
3. 填写具体结果，例如 `Proposition 4.1，PDF 第 13 页，公式 (20)`；换论文时也要修改目标。
4. 可补充困惑，例如“先写出引用的定义，突出等式成立的理由及依赖条件，不要只复述原文”。
5. 确认有权发送论文，勾选同意，再开始分析；完成后按来源页码核对。

选择新文件或填写 arXiv 链接后必须完成导入并重新同意，不能继续分析旧文件；导入失败不会沿用旧论文。切换导入方式会清空尚未导入的选择，不删除已经保存的论文。历史任务的“修改问题并重新分析”恢复该任务的原论文和问题，不会自动发送新任务。

arXiv 导入会联网从 arxiv.org 下载 PDF 到本机，不会自动开始 AI 分析或发送论文给 OpenAI。支持 arXiv 的 PDF 链接、摘要链接、编号及指定版本（例如 `2309.07041v3`），也支持旧式编号（例如 `math/0309136`）；不支持任意网站的 PDF 链接。下载受大小与超时限制；网络不通时可自行下载 PDF，再选择“本地 PDF”导入。

不需要的阅读记录可点击旁边的“删除记录”，核对论文与目标后确认。删除不可撤销，会移除该条记录、分析结果及任务工作文件，但保留导入的 PDF 和提取文本，不影响其他记录。正在等待或分析的任务需先取消或等待结束；删除不会撤回已发送给 OpenAI 的文本或退回已产生的用量。

## 能力与当前限制

- 展示原文陈述、通俗解释、符号、证明目标与策略、数学推理、相关结论及作用；公式用 KaTeX 排版。
- 保留页码和依据，区分原文明示与推断；找不到目标时明确报告，不用其他结论替代。
- 保存论文、任务和结果，支持取消；失败、取消或重启后不自动重新发送。
- 同时最多一个分析任务。每篇 PDF 限 **30 MiB、250 页、600,000 个提取字符**，解析超时 60 秒；超限拒绝，不静默截断。
- 只读取 PDF 文本层，**暂不支持 OCR**。扫描件、加密文档及复杂公式可能无法可靠提取。程序校验不等于数学正确性验证，AI 解释仍须核对。
- 单用户本机应用，不适合公网部署；不要开放端口、建立公网隧道或绑定 `0.0.0.0`。

## 示例与本机数据

[静态示例](http://127.0.0.1:3100/example)保留 Proposition 4.1 的人工整理数据，不调用 AI。数据位于 `data/wall-crossing/proposition-4.1.json`，不是新上传论文的分析结果。

发布文件**不附带示例 PDF**，因为其再分发权限尚未确认。没有 PDF 也能阅读解读。若合法持有对应的 *Wall crossing for symplectic vortices and quantum cohomology* 论文，可自行放到：

```text
frontend/public/papers/wall-crossing-symplectic-vortices.pdf
```

请使用对应的 60 页版本，其他版本的页码可能不同。该本机文件不应提交 Git。不要用任意论文替换示例；自己的论文请从首页导入。

论文、提取文本、任务与结果保存在 `.local/`。该目录、PDF、环境文件、登录凭据、依赖和日志不属于发布内容。备份时按私人数据处理；删除或重新克隆项目前先备份需要保留的数据。

## 常见问题

**网页打不开**：确认终端仍运行且打印“已启动”。构建期间还没有网页。运行 `doctor`；端口被占用时在原终端停止旧服务。

**换论文不能开始**：先点“导入到本机”或“下载并导入”，确认文件名，再重新勾选同意。文件选择框或 arXiv 输入框不是“当前论文”的替代。

**找不到 Codex、版本旧或未登录**：在启动项目的同一终端运行 `codex --version`、`codex login status`；必要时安装并 `codex login`。不要复制凭据进仓库。

**`failed to initialize in-process app-server client` / `Operation not permitted`**：可能是外层受限环境阻止 Codex 启动，不是 PDF 不能处理。请在自己的普通 Terminal 启动，不要复制令牌或关闭安全检查来绕过。

**Apple Silicon 原生依赖不匹配**：避免混用 Rosetta / Intel 和 ARM 运行时。使用原生终端、Python 和 Node.js。若通过 Homebrew 安装了原生 Python，可运行 `/opt/homebrew/bin/python3 scripts/project.py start`；这不是所有电脑都存在的必需路径。

**网络、配额或模型错误**：按页面提示解决后手动重试，不自动换付费 API 或重复消耗配额。默认使用 Codex 默认模型、`high` 推理强度；可在启动前设置 `READER_CODEX_MODEL` 为自己账号实际可用的模型 ID，这不是 API Key。

## 开发与发布

```text
PaperREADed/
├── scripts/                   # 环境准备、启动、检查与测试
├── frontend/                  # Next.js、KaTeX、同源代理与界面测试
├── backend/                   # FastAPI、PDF 导入、Codex 任务与测试
├── data/wall-crossing/         # 静态 benchmark JSON
├── docs/                      # 接口、验收与发布说明
└── .local/                    # 运行时私人数据，不提交
```

安装后从根目录运行 `make check`，或按[贡献说明](CONTRIBUTING.md)逐项测试。自动化检查不调用真实 AI、不需要登录凭据。每次更新上传后仍需检查对应的 GitHub Actions 结果，不能据本机测试声称远程检查已通过。

- [本机验收与真实 AI 边界](docs/local-verification.md)
- [贡献说明](CONTRIBUTING.md)
- [安全与隐私](SECURITY.md)
- [发布清单](docs/releasing.md)
- [本机接口约定](docs/local-ai-contract.md)

## 许可证

原创项目代码采用 [MIT 许可证](LICENSE)，Copyright (c) 2026 xmk0127。论文原文、benchmark 中的论文引文以及第三方依赖不因此获得 MIT 授权；各自的权利与许可仍适用，详见 [第三方内容说明](NOTICE.md)。源码包不包含论文 PDF。MIT 授权不改变当前私有仓库的访问权限，也不代表真实 AI 分析已完成验收。
