请检查下面这段 Vue 代码（来自 {{file}}）里的响应式问题，只报告确实存在的问题，并给出最小修改。

重点看：
1. 丢失响应式：解构 `reactive` 对象或 props 后直接使用、把 `ref` 的 `.value` 赋给普通变量后期望它更新、`await` 之后才调用组合式 API。
2. `watch` 的写法：监听对象属性是否用了 getter，是否滥用 `deep` / `immediate`，能用 `computed` 的地方是否用 `watch` 去同步数据，是否可能造成无限循环。
3. 清理：定时器、事件监听、订阅是否在 `onUnmounted`（或 `onWatcherCleanup`）里清理。
4. 模板：`v-for` 的 `key` 是否稳定、`v-if` 与 `v-for` 是否在同一元素上、是否在模板里做了昂贵的计算。
5. 直接修改 props，或在 `computed` 里产生副作用。

先看项目的 Vue 版本再下结论，不改与问题无关的代码。每个问题写清位置、原因、修复。

代码：

```
{{selection}}
```
