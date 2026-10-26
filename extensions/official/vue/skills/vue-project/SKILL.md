---
name: vue-project
description: 在 Vue 3 项目里写组件、跑测试、修类型错误和警告时使用，先认出构建工具和包管理器再动手。Use when working in a Vue project: detect Vite / vue-tsc / Vitest / Vue Router / Pinia / ESLint setup, run checks and fix Vue warnings without switching tools.
---

# Vue 项目工作流

## 原则

- 先看项目里已有的配置和锁文件，**用项目自己的工具**；不擅自换构建工具、包管理器或状态库，不擅自加依赖或升级依赖。
- 需要新依赖时先说明理由并征得同意，再用项目的包管理器添加；不要手改锁文件。
- 不要提交 `node_modules/`、`dist/`、`.vite/`、`coverage/`。
- 先看周围组件的写法（`<script setup>` 还是选项式、JS 还是 TS、样式用 scoped / CSS Modules / Tailwind），保持一致，不顺手重构。

## 认工具链

| 线索 | 工具 | 常用命令 |
| --- | --- | --- |
| `pnpm-lock.yaml` / `yarn.lock` / `package-lock.json` / `bun.lock` | pnpm / Yarn / npm / Bun | 一律用对应的包管理器，不混用 |
| `vite.config.*`，`package.json` 里有 `vite` | Vite | `dev`、`build`、`preview` 脚本 |
| `nuxt.config.*` | Nuxt | 按 `package.json` 的脚本（`nuxt dev`、`nuxt build`），目录约定（`pages/`、`composables/`）自动导入 |
| `tsconfig.app.json` / `tsconfig.json` + `vue-tsc` | vue-tsc | `vue-tsc --noEmit`（Vite 模板常见是 `vue-tsc --build`），先看 `type-check` 脚本 |
| `vitest.config.*` 或 vite 配置里有 `test` | Vitest | `vitest run`（单次），`vitest run 文件` 跑单个文件 |
| `eslint.config.*` / `.eslintrc.*` | ESLint（含 `eslint-plugin-vue`） | `eslint .`，有 `lint` 脚本就用脚本 |
| `.prettierrc*` / `@vue/eslint-config-prettier` | Prettier | 有 `format` 脚本就用脚本 |
| `src/router/` 或依赖里有 `vue-router` | Vue Router | 路由表在 `router/index.ts`，页面常放 `views/` |
| `src/stores/` 或依赖里有 `pinia` | Pinia | store 用 `defineStore`，放 `stores/` |

先读 `package.json` 的 `scripts`，里面写了什么就跑什么。

## 验证改动

按项目已有的脚本，先快后慢，只跑项目里有的：

1. 类型检查：`vue-tsc --noEmit`（或脚本 `type-check`）。普通 `tsc` 看不懂 `.vue` 文件，不能代替 `vue-tsc`。
2. Lint：`eslint .`（Vue 单文件组件的 `<template>` 也会被检查）。
3. 测试：`vitest run`；改了一处时只跑相关文件，最后再跑完整测试。组件测试用 `@vue/test-utils` 的 `mount` / `shallowMount`。
4. 构建：`vite build`（脚本 `build`）确认能通过；有的项目 `build` 已包含类型检查。

不要为了让检查通过就加 `// @ts-ignore`、`any` 或关掉 ESLint 规则，除非先说明原因。

## 写组件

- 新组件优先沿用项目风格；Vue 3 新代码默认 `<script setup lang="ts">`。
- props 用类型声明（`defineProps<{ ... }>()`），默认值用 `withDefaults` 或解构默认值（Vue 3.5+）；事件用 `defineEmits<{ change: [value: string] }>()`。
- 不要直接改 props；需要双向绑定用 `defineModel`（3.4+）或 `update:xxx` 事件。
- `v-for` 必须写稳定的 `:key`（用 id，不用下标）；不要在同一个元素上同时写 `v-if` 和 `v-for`。
- 组件和 composable 的文件名沿用项目约定（`PascalCase.vue`、`useXxx.ts`）。

## 常见坑

- **丢失响应式**：解构 `reactive` 对象或 props（3.5 以前）会得到普通值，用 `toRefs` / `toRef` 或 `computed`；`ref` 在 `<script>` 里要写 `.value`，模板里自动解包。
- `watch` 监听对象属性要写成 getter：`watch(() => state.count, ...)`；需要深度监听才加 `{ deep: true }`。能用 `computed` 的不要用 `watch` 去同步数据。
- 在 `onMounted` / `watch` 里添加的监听器、定时器、事件要在 `onUnmounted` / `onWatcherCleanup` 里清理。
- 访问模板引用要等到挂载之后；`await` 之后再调用组合式 API（`onMounted`、`inject`）会拿不到组件实例。
- SSR / Nuxt 项目里不要在 setup 顶层访问 `window`、`document`，放进 `onMounted`；服务端和客户端渲染不一致会报水合警告（hydration mismatch）。
- 自定义标签被当成未知组件时（`Failed to resolve component`），先查是否漏了导入或注册（`<script setup>` 里导入即可用），再考虑 `isCustomElement` 配置。
- 路径别名 `@/` 在 Vite、tsconfig、Vitest 里各配一处，三处要一致。
- 环境变量要以 `VITE_` 开头才会暴露给客户端，用 `import.meta.env.VITE_xxx` 读取。
