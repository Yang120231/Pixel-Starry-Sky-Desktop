# Pixel-Starry-Sky-Desktop

**像素星空**：一个桌面端 AI 编程工作台。在一个窗口里管理本机和云端机器、项目、会话，让 Claude Code / Codex 帮你写代码。

## 下载

到 [Releases](https://github.com/xiaoheoxo/Pixel-Starry-Sky-Desktop/releases) 下载最新版本（目前只有 Windows）。

还没有代码签名，第一次运行时 Windows 会提示「未知发布者」，点「更多信息 → 仍要运行」。

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
