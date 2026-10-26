# 上游来源

| 文件 | 来源 | 提交 | 许可证 |
| --- | --- | --- | --- |
| `syntaxes/svelte.tmLanguage.json` | https://github.com/sveltejs/language-tools/blob/e549d195c201fa44ec127d1303b0c0182026ed29/packages/svelte-vscode/syntaxes/svelte.tmLanguage.src.yaml | `e549d195c201fa44ec127d1303b0c0182026ed29`（sveltejs/language-tools，该文件最近一次提交，2026-10-14） | MIT |

- 上游只维护 YAML 源文件 `svelte.tmLanguage.src.yaml`，发布时由 `js-yaml`（`npx js-yaml`）转成 JSON；本扩展用同样的方式把该提交的 YAML 原样转成 `svelte.tmLanguage.json`，没有改动任何内容。
- 版权声明和许可证全文见 `LICENSE` 末尾。

其余文件（`language-configuration.json`、`samples/`、`snippets/`、`skills/`、`prompts/`）均为本扩展自写。
