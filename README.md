# Pixel-Starry-Sky-Desktop

**像素星空**：一个桌面端 AI 编程工作台。在一个窗口里管理本机和云端机器、项目、会话，让 AI 编程 agent 帮你写代码。

> 当前阶段：**Phase 0 规划**。还没有可运行的代码，详见 [路线图](docs/ROADMAP.md)。

## 文档索引

| 文档 | 内容 | 什么时候看 |
|---|---|---|
| [AGENTS.md](AGENTS.md) | 协作规则：工作流程、`scratch/` 临时文件规则、提交规范 | **开始任何工作之前** |
| [docs/ROADMAP.md](docs/ROADMAP.md) | 分阶段路线图和当前进度 | 想知道下一步做什么 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 技术栈、分层架构、目录结构、竞品调研 | 写代码前了解整体结构 |
| [docs/ui/workbench.md](docs/ui/workbench.md) | Phase 1 界面规格：工作台会话页的布局、组件、交互、验收标准 | 做界面时 |
| [docs/ui/design-tokens.md](docs/ui/design-tokens.md) | 浅色 / 深色两套配色、字体、圆角，主题切换规则 | 写任何样式时 |
| [docs/ui/design-refresh.md](docs/ui/design-refresh.md) | 界面美化 v2：调研结论、暖灰 + 墨绿方案、图标栏 / 侧边栏分工 | 改布局或配色前 |
| [docs/ui/settings.md](docs/ui/settings.md) | 设置界面：外观（主题、动画、字体、壁纸）、快捷键、关于 | 加新设置项时 |
| [docs/ui/usage.md](docs/ui/usage.md) | 用量与调用记录：记什么、存哪里、用量页、回复下方统计行 | 做用量 / 计费相关功能时 |
| [docs/ui/cloud-machines.md](docs/ui/cloud-machines.md) | Phase 2 界面规格：云主机页面 | Phase 2 |
| [docs/engines.md](docs/engines.md) | 引擎系统：接入 Claude Code / Codex 的结构、协议、权限、界面改动（v1 已接入 Claude Code） | 做引擎 / 会话功能时 |
| [docs/DECISIONS.md](docs/DECISIONS.md) | 决策记录：选了什么、为什么、放弃了什么 | 想改某个技术选择之前 |

## 技术栈

TypeScript + Electron + React（界面），Rust（Agent 核心，后续阶段），全部放在这一个仓库里。理由见 [DECISIONS.md](docs/DECISIONS.md)。

## 快速开始

需要：Node 22+、pnpm 10+。

```bash
pnpm install       # 安装依赖（会下载 Electron）
pnpm dev           # 开发模式（空界面，没有任何数据），改代码自动刷新
pnpm dev:demo      # 开发模式（演示数据，照参考图，用来对照调样式）
pnpm typecheck     # 类型检查（所有包）
pnpm test          # 单元测试（packages/protocol、packages/engine，不调用真实模型）
pnpm --filter @pixelsky/engine smoke   # 用本机真实的 Claude Code 跑几轮对话（会消耗少量额度）
pnpm build         # 构建到 apps/desktop/out
pnpm capture       # 截空界面的浅色 / 深色两张图到 docs/screenshots/
pnpm capture:demo  # 截演示数据的浅色 / 深色两张图
pnpm dist          # 打包 Windows 便携版 exe 到 apps/desktop/release/
```

**便携版 exe**：`pnpm dist` 生成 `PixelSky-<版本>-portable.exe`，双击即可运行，不用安装（每次启动先解压，会慢几秒）。默认是空界面；想看演示数据，给 exe 加启动参数 `--demo`（例如建一个快捷方式，在「目标」末尾加 ` --demo`）。还没有签名，第一次运行时 Windows 会提示「未知发布者」，点「更多信息 → 仍要运行」。

**常见问题**

- **Electron 下载失败（`fetch failed`）**：电脑走代理时，Node 默认不使用系统代理。设置 `NODE_USE_ENV_PROXY=1` 后重装：
  ```bash
  NODE_USE_ENV_PROXY=1 node node_modules/.pnpm/electron@*/node_modules/electron/install.js
  ```
- **窗口打不开，报 `ipcMain` 为 undefined**：终端里有 `ELECTRON_RUN_AS_NODE` 环境变量（在 Mirasim 等 Electron 应用的终端里很常见）。`pnpm dev` 和 `pnpm capture` 已经自动去掉它；自己直接运行 electron 或在这类终端里启动打包好的 exe 时要先清掉（在资源管理器里双击不受影响）。
