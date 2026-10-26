# Svelte 支持

Svelte / SvelteKit 项目的语法高亮、常用代码片段（含 Svelte 5 runes），以及写测试、迁移 runes、看报错的技能和提示词。

## 装上以后

- **语法高亮**：软件本身没有 Svelte 的内置高亮，装上后 `.svelte` 文件直接用这个扩展的 TextMate 语法着色，不需要额外开关。
- **代码片段**（共 31 条，语言 id 是 `svelte`，在 `.svelte` 文件里输入前缀）：

| 前缀 | 作用 |
| --- | --- |
| `svelte5` `svelte4` | Svelte 5 / Svelte 4 组件骨架 |
| `script` `scriptmodule` `style` | script 块、模块级 script 块、style 块 |
| `props` `state` `derived` `derivedby` `effect` `bindable` `onprop` | `$props`、`$state`、`$derived`、`$derived.by`、`$effect`、`$bindable`、回调属性 |
| `children` `snippet` | 接收并渲染 children、`{#snippet}` 块 |
| `each` `eachelse` `if` `ifelse` `await` `key` `const` | `{#each}`、带 else 的 each、`{#if}`、if / else、`{#await}`、`{#key}`、`{@const}` |
| `head` `window` | `<svelte:head>`、`<svelte:window>` |
| `onclick` `bindinput` | 事件属性、输入框双向绑定 |
| `pagedata` | `+page.svelte` 里读取 `load` 返回的 `data` |
| `pagels` `pageserver` `actions` `endpoint` | SvelteKit 的 `+page.ts` load、`+page.server.ts` load、表单 actions、`+server.ts` 接口（语言 id 是 `svelte`，所以只在 `.svelte` 文件里补全；要写进 `.ts` 文件时，在 `.svelte` 文件里展开后复制过去） |
| `vitestcomp` | `@testing-library/svelte` 组件测试 |

- **任务**：不提供。`package.json` 里的脚本软件已经内置认得。
- **技能**：`svelte-project`，Claude Code 里是 `/ext-pixelsky-svelte:svelte-project`，Codex 里是 `$svelte-project`。教 AI 先判断 Svelte 4 还是 5、是不是 SvelteKit，用项目自己的包管理器和脚本跑 `svelte-check`、Vitest、Playwright，不擅自换工具或加依赖。
- **提示词**（输入框「/」菜单和编辑器右键里都有，需要先选中代码）：为选中代码写测试、迁移到 Svelte 5 runes、解释 Svelte 报错、补类型和无障碍。

## 已知问题

- 片段只对 `.svelte` 文件生效，SvelteKit 的 `.ts` 文件（`+page.ts`、`+server.ts` 等）里目前没有片段补全。
- 上游语法把 `<script>`、`{ }` 表达式、`<style>` 里的内容交给 JavaScript / TypeScript / CSS / SCSS / Less / PostCSS / Sass / Stylus / CoffeeScript / Pug / Markdown 等语法着色。软件的 TextMate 引擎里没有这些语法，所以这些部分**不会上色**：`<script>` 里的代码、模板里 `{ ... }` 中的表达式、`<style>` 里的 CSS 目前都是普通文本色；Svelte 自己的标签、`{#if}` / `{#each}` 等块语法、属性和指令可以正常着色。
- 扩展语法没有代码折叠。

## 来源和许可证

本扩展按 MIT 许可发布。语法文件 `syntaxes/svelte.tmLanguage.json` 来自 sveltejs/language-tools 的 `packages/svelte-vscode/syntaxes/svelte.tmLanguage.src.yaml`（MIT），由 YAML 原样转成 JSON；具体来源地址和提交号见 `SOURCE.md`，版权声明和许可证全文附在 `LICENSE` 末尾。片段、技能、提示词和示例代码为本扩展自写。
