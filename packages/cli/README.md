# @pixelsky/cli

像素星空的命令行智能体，命令 `pixelsky`。计划见 `docs/own-cli.md`。

- 基于 [Pi](https://github.com/earendil-works/pi)（`@earendil-works/pi-coding-agent` 1.2.0，MIT）。协议全文见 `LICENSES/pi-coding-agent-MIT.txt`，发布产品时必须随附。
- 换品牌：用 pnpm 补丁（`patches/@earendil-works__pi-coding-agent@1.2.0.patch`）改依赖包 `package.json` 的 `piConfig`（名字 `pixelsky`，配置目录 `.pixelsky`）。升级 Pi 时重新 `pnpm patch` 并检查。
- `src/cli.ts` 在加载 Pi 前设 `PI_TELEMETRY=0`、`PI_SKIP_VERSION_CHECK=1`（用户已设置则不覆盖）。
- 配置目录默认 `~/.pixelsky/agent`，可用环境变量 `PIXELSKY_CODING_AGENT_DIR` 改。

## 运行

需要 Node 22.19+（Node 24 直接运行 TS）：

```
node packages/cli/src/cli.ts            # 交互模式
node packages/cli/src/cli.ts --mode rpc # RPC：标准输入输出一行一个 JSON，按 \n 切行，不要用 readline
```

Electron 自带的 Node 也可以：`ELECTRON_RUN_AS_NODE=1 electron.exe packages/cli/src/cli.ts ...`
