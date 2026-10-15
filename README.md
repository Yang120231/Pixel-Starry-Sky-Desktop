# Pixel-Starry-Sky-Desktop

**像素星空**：一个桌面端 AI 编程工作台。在一个窗口里管理本机和云端机器、项目、会话，让 Claude Code / Codex 帮你写代码。

## 下载

到 [Releases](https://github.com/xiaoheoxo/Pixel-Starry-Sky-Desktop/releases) 下载最新版本（目前只有 Windows）。

还没有代码签名，第一次运行时 Windows 会提示「未知发布者」，点「更多信息 → 仍要运行」。

## 批量导入项目

在本机项目列表的「＋ → 批量导入项目…」中，可以累计选择不同位置的项目文件夹、扫描父文件夹，或发现 Claude Code、Codex、Z Code 和 Kimi Code 保存的本机项目。预览支持搜索、勾选、去重和失效路径提示，也可以把导入的独立项目放入同一个分区。

自动发现支持 Claude 的 `.claude.json`、Codex 的 `.codex-global-state.json`、Z Code 的 `setting.json` 和只读任务索引，以及新版 Kimi Code 的 `workspaces.json`、旧版 Kimi CLI 的 `kimi.json`。支持相应工具的目录环境变量；使用自定义位置时，也可以手动选择清单，或粘贴路径、读取每行一个绝对路径的 TXT / JSON 字符串数组。最多预览 10000 个路径，分批添加，失败项保留以便重试。

导入只登记已有项目文件夹，不搬动文件，也不迁移会话或工具设置。Z Code 的远程工作区、无项目会话和 Kimi 已删除的工作区不会导入。

## 从源码运行

需要：Node 22+、pnpm 10+。

```bash
pnpm install       # 安装依赖（会下载 Electron）
pnpm dev           # 开发模式
pnpm dev:demo      # 开发模式（演示数据）
pnpm check         # 类型检查、测试、ESLint、Prettier
pnpm dist          # 打包到 apps/desktop/release/
```

**Electron 下载失败（`fetch failed`）**：电脑走代理时，Node 默认不使用系统代理。设置 `NODE_USE_ENV_PROXY=1` 后重装：

```bash
NODE_USE_ENV_PROXY=1 node node_modules/.pnpm/electron@*/node_modules/electron/install.js
```
