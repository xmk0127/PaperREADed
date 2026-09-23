# PaperREADed 发布清单

项目仓库为 [xmk0127/PaperREADed](https://github.com/xmk0127/PaperREADed)，目前为私有。所有者已确认采用 MIT 许可证，署名 xmk0127。以下清单用于上传与发布，不代表清单中所有检查已完成；现有 `math-paper-reader` 文件夹不必改名。

## 发布前检查

- [x] 所有者确认代码采用 MIT 许可证，Copyright (c) 2026 xmk0127；随源码保留 `LICENSE` 和 `NOTICE.md`。
- [ ] 检查 benchmark JSON 中的论文引文与第三方内容，代码许可证不能自动覆盖它们。
- [ ] 确认示例 PDF 再分发权限。当前方案是**不提交、不打包任何 PDF**，用户自行合法获取；公开可下载不等于可随代码再分发。
- [ ] 在普通终端完成[真实 AI 验收](local-verification.md)，或明确标为未完成验收的预览版。
- [x] 仓库归属与名称为 `xmk0127/PaperREADed`，当前可见性为私有。
- [ ] 获得上传授权后，仅上传经过审查的源码；公开仓库或发布 release 仍需所有者确认。

## 干净安装与检查

用待发布文件建立临时副本，不复制私人数据、PDF、环境文件或已有依赖。按 README 从零运行 `setup`、`doctor`、`make check` 和 `start`，记录脱敏结论。CI 不应配置 ChatGPT 登录文件、API Key 或真实论文分析任务。

检查 `.nvmrc`、前端 `engines`、启动器及 CI 的 Node 版本要求一致；前端使用 `npm ci`，后端按锁文件安装。依赖升级后重新测试，不能只修改说明。

## 生成本地源码预览包

```bash
python3 scripts/release_bundle.py --list
python3 scripts/release_bundle.py
```

`--list` 先查看将包含的文件；第二条命令生成 `dist/PaperREADed-source.zip`。脚本使用白名单，排除 PDF、私人数据、环境文件、凭据、依赖、缓存和符号链接，不删除原件，也不覆盖已有 ZIP；已有包时请先将其移到自己的备份位置再生成。

这只是本地源码预览包，不是已发布的 GitHub release。原创项目代码按随包的 MIT 许可证提供；MIT 不覆盖论文原文、第三方引文或依赖的权利。分享前仍须审查文件列表及上述授权边界。

## 提交前隐私审查

以下检查用于**将来已初始化 Git、且获提交授权后**，不会替你发布：

```bash
git status --short
git diff --cached --stat
git diff --cached
git ls-files
```

逐项确认没有 `.local/`、`auth.json`、令牌、`.env`、PDF、提取文本、任务结果、日志、`node_modules`、`.venv` 或构建产物。截图也要检查姓名、私人路径、登录状态和论文内容。

`.gitignore` 只阻止未跟踪文件被默认加入；`.gitattributes` 的导出排除也不删除 Git 历史。私人内容已经进入历史时，仅补 ignore 不够，应停止发布，评估清理和凭据撤销。不要未经授权删除本机论文或结果来“清理项目”。

## 获得发布授权后

1. 向现有私有仓库 `https://github.com/xmk0127/PaperREADed` 上传审查后的代码与文档，不上传个人登录状态，不擅自改为公开。
2. 确认 README 的实际仓库地址、访问条件及上传状态与当前情况一致；确认 `LICENSE` 和 `NOTICE.md` 随代码提交。
3. 确认 GitHub Actions 实际运行成功，并且只使用模拟 AI 测试；本地配置不等于远程 CI 已通过。
4. 发布说明写清平台验证范围、已知限制、真实 AI 验收状态和数据发送行为。
5. 从发布的仓库重新下载，按 README 验证，不依赖开发者机器上的额外文件。

每位使用者在自己的电脑安装并登录 Codex。GitHub 托管代码，不托管本机应用、论文或账号登录；不要用 GitHub Pages 替代本项目所需的本机 Python / Codex 服务。
