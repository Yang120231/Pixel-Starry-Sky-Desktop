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
| [docs/ui/cloud-machines.md](docs/ui/cloud-machines.md) | Phase 2 界面规格：云主机页面 | Phase 2 |
| [docs/DECISIONS.md](docs/DECISIONS.md) | 决策记录：选了什么、为什么、放弃了什么 | 想改某个技术选择之前 |

## 技术栈

TypeScript + Electron + React（界面），Rust（Agent 核心，后续阶段），全部放在这一个仓库里。理由见 [DECISIONS.md](docs/DECISIONS.md)。

## 快速开始

Phase 1 完成后补充。
