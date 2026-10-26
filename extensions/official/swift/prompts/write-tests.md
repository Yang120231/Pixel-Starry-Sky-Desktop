请为下面这段 Swift 代码（文件 {{file}}，项目 {{project}}）写单元测试。

要求：
1. 先看项目里已有的测试：用的是 XCTest 还是 Swift Testing（`import Testing`、`@Test`、`#expect`），沿用同一种和现有的目录结构（SwiftPM 项目在 `Tests/<目标>Tests/`，Xcode 工程看已有的测试 target），不要混用，也不要擅自引入新的测试依赖。
2. 覆盖正常路径、边界值（空集合、空字符串、0、负数、nil）和会抛错的路径（XCTest 用 `XCTAssertThrowsError`，Swift Testing 用 `#expect(throws:)`）。
3. 测试名说清场景和预期，每个测试只验证一件事；需要时用 `@testable import` 访问 internal 成员。
4. 写完后用项目自己的方式运行（SwiftPM 用 `swift test`，只跑一个用 `swift test --filter 名字`；Xcode 工程用 `xcodebuild test` 并带上项目已有的 scheme 和 destination），失败时先弄清原因再修，不要为了通过而改被测代码。

被测代码：

```swift
{{selection}}
```
