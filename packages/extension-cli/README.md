# @pixelsky/extension-cli

`pixelsky-ext`：扩展作者用的命令行工具（`validate` / `pack`）。完整说明在 `docs/extensions/cli.md`（本地文档，不入库），这里写要点。

## 用法

需要 Node 20 或更新版本。在仓库里：

```
pnpm ext validate <扩展文件夹或 .zip>
pnpm ext pack <扩展文件夹> [-o 输出.zip 或已有文件夹] [--dry-run]
pnpm --filter @pixelsky/extension-cli build   # 只构建 dist/pixelsky-ext.mjs（单文件，已内嵌 Oniguruma wasm）
```

常用参数：`--level upload|dev`、`--grammar full|regex|off`、`--app-version`、`--strict`、`--json`、`--lang zh|en`、`--no-color`。

## 退出码

| 码 | 意思 |
| --- | --- |
| 0 | 通过 |
| 1 | 不通过（pack 时不写文件） |
| 2 | 用法错误 |
| 3 | 工具自身出错 |

`--json` 的结构见 `docs/extensions/cli.md` §6.2（`schema: 1`，只加字段不改字段）。

## 与软件内检查的一致性

规则只有一份，在 `packages/protocol/src/extpacks/`（`checkPack`）。软件「从文件夹加载」和本工具的 `--level dev` 调用同一个函数，
用同一批共享用例（`packages/protocol/corpus/extpacks/`）验证。本包以子路径导出供软件主进程使用：
`./folder`（文件夹读取，主进程只能用它和 `./zip`）、`./zip`、`./grammar`、`./check`、`./testing`。语法引擎（`./grammar`、`./check`）不进主进程，有 eslint 规则限制。

## 仅供测试的环境变量

- `PIXELSKY_EXT_HANG_MS`：覆盖分词的硬超时（默认 10 000 ms），只给 `test/bundle.test.ts` 的回溯爆炸用例用，正常使用不要设。

## 第三方许可

构建时 `LICENSES/` 里的许可证会合并成 `dist/THIRD-PARTY-NOTICES.txt`：vscode-textmate（MIT）、vscode-oniguruma（MIT）和 Oniguruma（BSD-2-Clause）、fflate（MIT）。分发构建结果时要一起带上。
