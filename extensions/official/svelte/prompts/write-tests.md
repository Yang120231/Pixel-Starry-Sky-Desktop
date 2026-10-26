请为下面这段 Svelte 代码（文件 {{file}}，项目 {{project}}）写测试。

要求：
1. 先看项目已有的测试：用的是 Vitest 还是别的、有没有 @testing-library/svelte、测试文件放哪里、怎么命名，保持一致；不要擅自安装新依赖。
2. 先判断项目是 Svelte 4 还是 Svelte 5（看 package.json），按对应写法挂载组件和触发更新（Svelte 5 里改了状态后需要 await tick() 或用 flushSync）。
3. 组件测试按用户看到的行为断言（文本、按钮、输入），不要断言内部变量；覆盖正常输入、空值或边界、事件回调。
4. 只替换网络请求等外部依赖，不要把组件本身 mock 掉。
5. 写完用项目自己的命令（如 pnpm vitest run 该文件）运行，失败就修到通过，并告诉我运行结果。

代码：

```svelte
{{selection}}
```
