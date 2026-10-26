请把下面这段 Swift 代码（文件 {{file}}）从回调、DispatchQueue 或 Combine 的写法改成 Swift 并发（async/await）。

要求：
1. 先确认项目的 Swift 版本和并发检查设置（`Package.swift` 的 `swift-tools-version`、`swiftLanguageModes`、`StrictConcurrency`，或 Xcode 工程的 Swift Language Version），只使用该版本支持的特性。
2. 用 `async throws` 函数、`withCheckedThrowingContinuation`（包装老的回调 API）、`AsyncStream`、`TaskGroup` 等；界面更新放在 `@MainActor` 上。
3. 注意 `Sendable` 和 actor 隔离，跨并发域传递的类型要满足 `Sendable`；不要用 `@unchecked Sendable` 糊过去。
4. 调用方一起改，保持对外行为一致；改完用 `swift build` 和 `swift test`（或项目自己的命令）验证。

代码：

```swift
{{selection}}
```
