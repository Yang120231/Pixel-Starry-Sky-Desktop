---
name: swift-project
description: 在 Swift 项目里写代码、跑测试、修编译报错时使用，包括判断 SwiftPM 还是 Xcode 工程、运行 XCTest / Swift Testing、swift-format / SwiftLint。Use when working in a Swift project: SwiftPM vs Xcode project, building, running XCTest or Swift Testing, swift-format, SwiftLint, fixing compiler errors.
---

# Swift 项目工作指南

## 先认工具链，不要擅自换

1. 看根目录（和子目录）里有什么：
   - `Package.swift` 是 SwiftPM 包；`*.xcodeproj` / `*.xcworkspace` 是 Xcode 工程；两者可以并存（工程里引用本地包）。
   - 辅助配置：`.swift-format`、`.swiftlint.yml`、`.swift-version`、`Package.resolved`、`Podfile` / `Cartfile`（CocoaPods / Carthage）、`.github/workflows`、`fastlane/`。
2. 沿用项目已有的构建方式、测试框架和依赖管理。**不要**把 Xcode 工程改成 SwiftPM（或反过来），**不要**为方便新增包依赖或升级版本；确实需要时先说明理由，让用户确认。
3. `Package.resolved` 是锁定版本，不手改；依赖变了用 `swift package resolve` / `swift package update` 更新。

## 识别 Swift 版本和平台

- `Package.swift` 第一行 `// swift-tools-version: 5.9` 是最低工具链；`swiftLanguageModes: [.v5]` / `.v6` 决定语言模式（Swift 6 模式默认严格并发检查）；`platforms: [.macOS(.v13)]` 是最低系统。
- Xcode 工程看 Build Settings 的 Swift Language Version 和 Deployment Target。
- 本机版本：`swift --version`；Linux / Windows 上没有 Apple 专有框架（SwiftUI、UIKit、Combine 等），先确认代码是否要跨平台。
- 只使用该版本支持的语法：`async/await` 5.5+，`if let x {` 简写 5.7+，宏和 `@Observable` 5.9+，Swift Testing 6.0+。

## 构建和验证（改完代码按这个顺序）

SwiftPM：

```
swift build                              # 先确认能编译
swift test                               # 运行全部测试
swift test --filter OrderTests           # 只跑一个测试类
swift test --filter OrderTests/testPay   # 只跑一个方法
swift run                                # 有多个可执行目标时 swift run <目标名>
```

- 格式和静态检查：项目有 `.swift-format` 时 `swift format lint -r Sources Tests`（修复用 `swift format format -i -r Sources Tests`，Swift 6 工具链自带，旧版是独立的 `swift-format`）；有 `.swiftlint.yml` 时 `swiftlint`（自动修 `swiftlint --fix`）。没配置就不要自己引入。

Xcode 工程（只有 macOS 上能跑）：

```
xcodebuild -list                                                  # 列出 scheme
xcodebuild -scheme <scheme> -destination 'platform=macOS' build
xcodebuild -scheme <scheme> -destination 'platform=iOS Simulator,name=iPhone 16' test
```

- scheme 和 destination 用项目里已有的（`xcodebuild -list`、CI 配置、README），不要自己编。有 `.xcworkspace` 时用 `-workspace`，否则 `-project`。
- **不要手改 `project.pbxproj`**：新增 / 删除文件、改 target 配置这类事让用户在 Xcode 里做，或明确告知需要这样做；用 SwiftPM 目标或 Xcode 16 的文件夹引用（folder reference）管理的目录除外，那里直接增删文件即可。
- 在 Linux / Windows 上无法构建 Xcode 工程，如实告诉用户没验证到，不要假装通过。

## 测试

- 先看现有测试用的是 XCTest（`import XCTest`、`XCTestCase`、`func testXxx`）还是 Swift Testing（`import Testing`、`@Test`、`#expect`、`#require`、`@Suite`）；照现有的写，不要在同一个文件里混用。两者可在同一个 target 里并存。
- SwiftPM 测试放 `Tests/<目标>Tests/`，用 `@testable import 目标名` 访问 internal 成员；测试 target 要在 `Package.swift` 里声明。
- 异步代码：XCTest 用 `async` 测试方法（或 `XCTestExpectation`），Swift Testing 直接 `async throws`；不要用 `sleep` 等时间。
- 先看测试失败的真实原因，不要为了变绿去改断言或删测试。

## 常见坑

- Swift 6 并发报错（`Sendable`、`actor-isolated`、`global variable is not concurrency-safe`）：根据报错改隔离（`@MainActor`、actor、值类型），不要全局降级成 Swift 5 模式或到处 `@unchecked Sendable`，除非用户要求。
- 缺 `try` / `await`、`Optional` 未解包：不要用 `!` 或 `try!` 压掉，用 `guard let` / `throws` 处理。
- `no such module`：先 `swift package resolve`，再检查 `Package.swift` 里 target 的 `dependencies`；Apple 框架在 Linux 上不存在，要用 `#if canImport(...)` 或 `#if os(...)`。
- 增量构建怪问题时用 `swift package clean`；`.build/` 和 Xcode 的 DerivedData 是产物，不提交、不手改。
- `swift run` 的可执行目标需要 `@main` 或 `main.swift`；`@main` 与 `main.swift` 不能同时出现在一个目标里。
- 公开 API（`public`）的改动会影响依赖方，改前搜清调用方，保持向后兼容或明确告知。
