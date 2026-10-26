# Vue 支持

Vue 3 单文件组件（`.vue`）的语法高亮、常用代码片段，以及 Vite / vue-tsc / Vitest 项目的技能和提示词。

## 装上以后

- **代码片段**（`.vue` 文件里输入前缀，共 36 条）：

| 前缀 | 作用 |
| --- | --- |
| `sfc` `setup` `tpl` `style` `styles` | 单文件组件骨架、script setup、template 块、scoped 样式、scoped scss 样式 |
| `props` `propsd` `emits` `model` `expose` `options` `slots` | defineProps、带默认值的 props、defineEmits、defineModel、defineExpose、defineOptions、defineSlots |
| `ref` `reactive` `computed` `computedw` | ref、reactive、计算属性、可写计算属性 |
| `watch` `watchi` `watchEffect` | watch、立即执行的 watch、watchEffect |
| `mounted` `unmounted` `tref` | onMounted、onUnmounted、模板引用 |
| `provide` `inject` `composable` | provide、inject、组合式函数骨架 |
| `store` `router` | Pinia store（setup 写法）、Vue Router 路由表 |
| `vfor` `vif` `vmodel` `von` `vslot` `component` | v-for、v-if / v-else、v-model、事件绑定、具名插槽、动态组件 |
| `teleport` `suspense` | Teleport、Suspense |
| `vtest` | Vue Test Utils + Vitest 组件测试 |

- **任务**：不提供。Vue 项目的脚本（`dev`、`build`、`test` 等）来自 `package.json`，软件内置已经认。
- **技能**：`vue-project`，Claude Code 里是 `/ext-pixelsky-vue:vue-project`，Codex 里是 `$vue-project`。教 AI 先认包管理器、Vite、vue-tsc、Vitest、Vue Router、Pinia、ESLint，用项目自己的脚本验证（`vue-tsc --noEmit`、`eslint`、`vitest run`、`vite build`），并避开丢失响应式、`watch` 滥用等常见坑。
- **提示词**（输入框「/」菜单和编辑器右键里都有，需要先选中代码）：为选中代码写 Vitest 测试、改写为 script setup + TypeScript、解释 Vue 警告或报错、检查响应式问题。
- **语法高亮**：软件内置没有 Vue 的高亮，装上本扩展后 `.vue` 文件直接使用扩展自带的 TextMate 语法，不需要手动开关。

## 已知问题

- 语法文件里 `<template>` 的 HTML、`<script>` 里的 JavaScript / TypeScript、`<style>` 里的 CSS / SCSS / Less 等是通过引用别的语法（`text.html.basic`、`source.ts`、`source.js`、`source.css`、`source.css.scss` 等）来着色的。软件的 TextMate 引擎里没有这些语法，所以这些部分**可能不上色**（或只有 Vue 自己的标签、指令、插值 `{{ }}` 这类部分有颜色）。
- 同样，`<script lang="tsx">`、`<template lang="pug">`、`<style lang="stylus">` 以及自定义块（`<i18n>` 等）里的内容也无法着色。
- 单文件组件里 `<docs lang="markdown">` 之类的 Markdown 自定义块引用的是软件内置语法，暂时不生效。
- 扩展语法没有代码折叠。
- 片段里的 `defineModel`（3.4+）、`defineOptions`（3.3+）、`useTemplateRef`（3.5+）需要对应的 Vue 版本，项目版本较低时请不要使用。

## 来源和许可证

本扩展按 MIT 许可发布。语法文件 `syntaxes/vue.tmLanguage.json` 来自 vuejs/language-tools 的 `extensions/vscode/syntaxes`，许可证为 MIT；具体来源地址和提交号见 `SOURCE.md`，版权声明和许可证全文附在 `LICENSE` 末尾。片段、技能、提示词和示例代码为本扩展自写。
