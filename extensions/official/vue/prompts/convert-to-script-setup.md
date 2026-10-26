请把下面这段 Vue 代码（来自 {{file}}）改写成 `<script setup lang="ts">` 写法，行为必须保持不变。

要求：
1. 先确认项目的 Vue 版本（看 package.json）：3.3 以前不要用 `defineOptions`，3.4 以前不要用 `defineModel`，3.5 以前不要用 props 解构的响应式语法和 `useTemplateRef`。
2. `data` 改成 `ref` / `reactive`，`computed` / `methods` / `watch` 改成对应的组合式 API，生命周期钩子改成 `onMounted` 等；`this.$refs`、`this.$emit`、`this.$route` 分别改成模板引用、`defineEmits`、`useRoute()`。
3. props 和事件用类型声明（`defineProps<{...}>()`、`defineEmits<{...}>()`），补全类型，不使用 `any`。
4. 需要保留组件名、`inheritAttrs` 等选项时用 `defineOptions`（或单独的普通 `<script>` 块）。
5. 模板里用到的变量名保持不变，必要时一并修改 `<template>`；不改样式和业务逻辑。
6. 改完说明变化点，并告诉我怎么验证（`vue-tsc --noEmit` 和项目的测试）。

代码：

```
{{selection}}
```
