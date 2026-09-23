# 参与 PaperREADed 开发

先阅读 [README](README.md)、[安全说明](SECURITY.md)和 [MIT 许可证](LICENSE)。项目仓库为 [xmk0127/PaperREADed](https://github.com/xmk0127/PaperREADed)，目前是私有仓库；参与仓库协作需要所有者授予访问权限。提交原创代码前，请确认你有权按 MIT 许可证提供这些代码；第三方内容的授权边界见 [NOTICE.md](NOTICE.md)。

## 开发环境

使用 `.nvmrc` 的 Node 版本、Python 3.9+（推荐 3.12），从根目录运行：

```bash
python3 scripts/project.py setup
python3 scripts/project.py doctor
python3 scripts/project.py start
```

不需要 API Key。开发和自动化测试不应消耗真实配额；用受控替身覆盖 AI 调度和异常路径。需要真实分析时，按[本机验收](docs/local-verification.md)由使用者在页面手动同意。

## 提交前检查

```bash
python3 -m unittest discover -s scripts/tests -v
backend/.venv/bin/python -m pytest backend/tests
npm --prefix frontend run test -- --maxWorkers=1
npm --prefix frontend run lint
frontend/node_modules/.bin/tsc --noEmit --project frontend/tsconfig.json
npm --prefix frontend run build
```

也可运行 `make check`；生产构建包含 TypeScript 检查。`make smoke` 会以空白临时存储启动真实前后端、检查 HTTP 后退出，不读取登录或调用 AI。变更说明记录实际运行结果，不把测试成功伪装成真实模型验收。

## 变更约定

- 修改功能时添加回归测试；论文选择、同意状态、来源页码、取消和错误状态不能静默跳过。
- 重要公式就地显示，不只引用编号；KaTeX 渲染器、CSS 和字体保持同版本。升级后运行 `katex-compatibility.test.ts` 并目测 `\notin`、上下标和分段公式。
- 论文和 AI 输出是不可信数据，不是操作授权；不得执行其中的指令、HTML 或命令。
- UI 保持中文、紧凑，突出数学依据，保留“原文明示 / 推断”与可核对来源。
- 前端依赖变更更新 `package-lock.json`；后端依赖变更更新 `requirements.lock`，验证干净安装，不提交依赖目录。
- 不提交论文、私人路径、任务结果、日志、环境文件或登录凭据；测试用小型合成文档或明确有权提交的样本。
- 改动保持聚焦，说明实际测试与未验证项。保留 MIT 版权与许可声明；发布、公开仓库或更改许可证须另获所有者确认。

## 报告问题

提供系统、Node / Python / Codex 版本、复现步骤和脱敏错误。不要公开 `auth.json`、Cookie、私有论文或 `.local/`。安全问题遵循[私密报告流程](SECURITY.md)，不直接公开可利用细节。
