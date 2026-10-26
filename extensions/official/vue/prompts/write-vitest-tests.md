请为下面的 {{language}} 代码（来自 {{file}}）写 Vitest 测试。

要求：
1. 先看项目里已有的测试文件（位置、命名、`describe` / `it` 的风格）和 `vitest.config` / `vite.config` 里的测试配置，保持一致；没有测试基础设施时先告诉我，不要擅自装依赖。
2. 组件用 `@vue/test-utils` 的 `mount`，通过 props、插槽和用户操作（`trigger`、`setValue`）驱动，断言渲染结果和 `emitted()`，不要测组件内部实现细节；改动响应式数据后用 `await nextTick()` 或 `await wrapper.trigger(...)`。
3. composable 和普通函数直接调用测试；依赖 Pinia 的先 `setActivePinia(createPinia())`，依赖路由的用 `createRouter` + `createMemoryHistory`。
4. 覆盖正常路径、边界（空值、空列表）和出错情况；只替换网络、时间等外部依赖。
5. 写完告诉我运行命令（例如 `vitest run 文件路径`），能运行就运行并修到通过。

代码：

```
{{selection}}
```
