---
name: svelte-project
description: 在 Svelte / SvelteKit 项目里写组件、跑检查和测试、修报错时使用，先判断是 Svelte 4 还是 Svelte 5（runes）再动手。Use when working in a Svelte or SvelteKit project: detect Svelte 4 vs 5, run svelte-check, Vitest and Playwright, fix compile and hydration errors.
---

# Svelte / SvelteKit 项目工作流

## 原则

- 先看项目里已有的配置和锁文件，**用项目自己的工具**；不擅自换工具，不擅自加依赖，不擅自升级 Svelte / SvelteKit 的大版本。
- 需要新依赖时先说明理由并征得同意，再用项目的包管理器添加；不要手改锁文件。
- `.svelte-kit/`、`build/`、`node_modules/` 是生成物，不要手改，也不要提交。

## 认工具链

- 包管理器看锁文件：`pnpm-lock.yaml` 用 `pnpm`，`package-lock.json` 用 `npm`，`yarn.lock` 用 `yarn`，`bun.lock` / `bun.lockb` 用 `bun`。`package.json` 的 `scripts` 是命令的权威来源，先读它再决定怎么跑。
- 有 `svelte.config.js`（或 `.ts`）和依赖里有 `@sveltejs/kit` 的是 SvelteKit；只有 `vite` + `@sveltejs/vite-plugin-svelte` 的是普通 Vite + Svelte 项目，没有 `src/routes`、`load`、`$app/*`。
- 看 `package.json` 里 `svelte` 的版本：`^5` 是 Svelte 5，`^4` 及以下是 Svelte 4。

## Svelte 4 和 5 的差异（先判断版本再写）

| 事项 | Svelte 4 | Svelte 5 |
| --- | --- | --- |
| 组件属性 | `export let name` | `let { name } = $props()` |
| 状态 | 顶层 `let count = 0` 自动响应 | `let count = $state(0)` |
| 派生 | `$: double = count * 2` | `let double = $derived(count * 2)` |
| 副作用 | `$: { ... }` | `$effect(() => { ... })` |
| 事件 | `on:click={fn}` | `onclick={fn}`（普通属性） |
| 组件事件 | `createEventDispatcher` | 回调属性（`onsave`） |
| 插槽 | `<slot />`、`<slot name="x">` | `{@render children()}`、`{#snippet x()}` |
| 双向绑定属性 | `export let value` + `bind:value` | `let { value = $bindable() } = $props()` |

- Svelte 5 仍然兼容大部分 Svelte 4 写法，但**同一个组件里不要混用**：用了 runes（`$state`、`$props` 等）的组件不能再用 `$:`、`export let`。已有的老组件没有要求就别顺手重写。
- `$state` 对对象 / 数组是深层响应的，直接 `list.push(x)` 就会更新；解构出来的值会失去响应，需要时用 `$derived` 或直接访问原对象。
- `$effect` 不是用来派生数据的，能用 `$derived` 就别用 `$effect`；`$effect` 在服务端不运行。
- `.svelte.ts` / `.svelte.js` 文件里才能在组件外使用 runes（共享状态）。

## 验证改动

先快后慢，只跑项目 `scripts` 里有的：

1. 类型和模板检查：`svelte-check`（常见脚本名 `check`：`pnpm check`）。SvelteKit 项目会先运行 `svelte-kit sync` 生成 `./$types`；`$types` 找不到时先跑 `svelte-kit sync`（`npx svelte-kit sync`）。
2. Lint 与格式化：项目有 ESLint（`eslint-plugin-svelte`）/ Prettier（`prettier-plugin-svelte`）就用 `pnpm lint`、`pnpm format` 之类脚本，不要改用别的。
3. 单元 / 组件测试：Vitest，`vitest run`；跑单个文件 `vitest run src/lib/x.test.ts`，按名字 `-t "关键字"`。组件测试多用 `@testing-library/svelte`，需要 `environment: 'jsdom'`（或 happy-dom），Svelte 5 下需要 vite 配置里加 `svelteTesting()` 插件或 `resolve.conditions: ['browser']`，先看项目 `vite.config` / `vitest.config` 的现有写法。
4. 端到端：Playwright，`npx playwright test`，单个文件 `npx playwright test tests/x.spec.ts`，`--ui` 调试；通常由 `playwright.config` 的 `webServer` 自己先构建并启动预览，不要手动再起一个占同一端口。
5. 构建：`vite build`（脚本多为 `pnpm build`），`vite preview` 看产物。适配器（`adapter-auto`、`adapter-node`、`adapter-static` 等）以 `svelte.config.js` 为准，不擅自更换。

## SvelteKit 要点

- 路由是文件夹：`src/routes/foo/+page.svelte`、`+page.ts`（浏览器和服务端都会运行）、`+page.server.ts`（只在服务端，可用密钥和数据库）、`+layout.*`、`+server.ts`（API）、`+error.svelte`。
- 数据用 `load` 返回，在页面里通过 `data` 属性读取；不要在组件里重复请求。load 里请求用传入的 `fetch`，不要用全局 `fetch`。
- 表单优先用 `actions` 加 `use:enhance`；`+page.server.ts` 里用 `fail(400, {...})` 返回校验错误。
- 只能在浏览器里访问 `window`、`document`、`localStorage`：放进 `onMount`、`$effect` 或用 `import { browser } from '$app/environment'` 判断。
- 项目路径别名：`$lib` 指向 `src/lib`；环境变量用 `$env/static/private` / `$env/dynamic/private`，只有 `PUBLIC_` 开头的才能给浏览器。
- `prerender`、`ssr`、`csr`、`trailingSlash` 通过 `+layout.ts` / `+page.ts` 导出控制，改之前先看现有设置。

## 常见坑

- 水合不一致（hydration mismatch）：服务端和浏览器渲染结果不同，多半是用了 `Date.now()`、`Math.random()` 或浏览器独有的值；把这类值放进 `onMount` 后再设置。
- `{#each}` 列表有增删或排序时必须带 key：`{#each items as item (item.id)}`，不能用下标当 key。
- 样式默认只作用于当前组件；要影响子组件用 `:global(...)` 或 CSS 变量，不要到处加 `!important`。
- 无障碍警告（`a11y_*`）是编译期给出的，按提示修（加 `alt`、`label`、键盘事件），不要靠 `<!-- svelte-ignore -->` 压掉，除非确有理由并写明。
- 改了 `svelte.config.js`、`vite.config` 或路由文件夹结构后，如果开发服务器行为异常，重启它并重新跑 `svelte-kit sync`。
