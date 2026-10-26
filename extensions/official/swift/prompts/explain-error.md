下面是 Swift 项目（{{project}}）里的编译报错、运行时崩溃或日志（来自 {{file}}）。请帮我定位根因。

要求：
1. 先读报错涉及的源码和相关类型定义，再下结论；不确定的地方说明还需要看什么。
2. 说明原因：类型推断失败、Optional 未解包、Sendable / actor 隔离违规、缺少 `try` / `await`、`Fatal error`（数组越界、强制解包 nil）、链接或模块找不到等。
3. 给出最小的修复，保持项目现有的 Swift 语言模式和并发设置，不要用 `@unchecked Sendable`、`!` 或 `nonisolated(unsafe)` 去压掉错误，除非说明为什么安全。
4. 修完用项目自己的命令验证（`swift build`、`swift test`，或 Xcode 工程的 `xcodebuild`）。

报错内容：

```
{{selection}}
```
