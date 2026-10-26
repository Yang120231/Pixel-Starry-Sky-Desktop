# Swift 支持

Swift 的语法高亮、常用代码片段、SwiftPM 任务，以及写测试、处理 Xcode 工程的技能和提示词。

## 装上以后

- **代码片段**（`.swift` 文件里输入前缀，共 35 条）：

| 前缀 | 作用 |
| --- | --- |
| `main` | `@main` 程序入口 |
| `struct` `class` `enum` `protocol` `extension` `actor` | 结构体、final 类、枚举、协议、扩展、actor |
| `func` `funct` `funca` `init` | 函数、会抛错的函数、async throws 函数、构造方法 |
| `guardlet` `iflet` `switch` | guard let、if let、switch |
| `forin` `forrange` | for-in 循环、区间循环 |
| `docatch` | do-catch |
| `task` `mainactor` `asynclet` `taskgroup` | Task、回到主 actor、并行 async let、抛错任务组 |
| `computed` `didset` `lazy` | 计算属性、属性观察器、懒加载属性 |
| `weakself` | 捕获 weak self 的闭包 |
| `codable` `hashable` | Codable 结构体、Hashable / Equatable 实现 |
| `view` `preview` | SwiftUI 视图、`#Preview` |
| `xctest` `xctasync` `testing` | XCTest 测试类、XCTest 异步测试、Swift Testing 测试 |
| `package` | `Package.swift` 骨架 |
| `mark` `doc` | `// MARK: -` 分段、`///` 文档注释 |

- **任务**：认 `Package.swift`（SwiftPM），列出 `build`（`swift build`）、`test`（`swift test`）；`Package.swift` 里出现 `executable`（可执行目标 / 可执行产品）时多出 `run`（`swift run`）。Xcode 工程（`.xcodeproj`）不在任务视图里，见「已知问题」。
- **技能**：`swift-project`，Claude Code 里是 `/ext-pixelsky-swift:swift-project`，Codex 里是 `$swift-project`。教 AI 先分清 SwiftPM 包和 Xcode 工程、从 `Package.swift` 识别 Swift 版本和并发模式、用项目自己的命令编译和跑 XCTest / Swift Testing、按配置跑 swift-format / SwiftLint，不手改 `project.pbxproj`、不擅自换构建方式或加依赖。
- **提示词**（输入框「/」菜单和编辑器右键里都有，需要先选中代码）：为选中代码写 Swift 测试、解释 Swift 编译报错、补 `///` 文档注释、改写为 async/await。
- **语法高亮**：软件没有内置的 Swift 高亮，装上这个扩展后 `.swift` 文件直接用扩展自带的 TextMate 语法，不用另外设置。

## 已知问题

- 扩展语法没有代码折叠。
- 任务视图只认 `Package.swift`；纯 Xcode 工程（只有 `.xcodeproj` / `.xcworkspace`）没有任务，请在输入框里让 AI 用 `xcodebuild`（技能里有写法），且只有 macOS 上能跑。
- `run` 靠 `Package.swift` 全文里有没有 `executable` 判断；可执行目标是靠 `@main` 或 `main.swift` 隐式识别、清单里没写 `executable` 的包不会出现 `run`。有多个可执行目标时，`swift run` 需要自己补目标名。
- 任务只找根目录往下 3 层，且跳过 `.build` 等 `.` 开头的目录；子目录里的包在各自的文件夹里运行。
- 语法由 jtbandes/swift-tmlanguage 提供，新语法特性（例如较新的宏写法）可能高亮不全。

## 来源和许可证

本扩展按 MIT 许可发布。语法文件 `syntaxes/swift.tmLanguage.json` 来自 microsoft/vscode 的 `extensions/swift`（由 jtbandes/swift-tmlanguage 转换），许可证为 MIT；具体来源地址和提交号见 `SOURCE.md`，版权声明和许可证全文附在 `LICENSE` 末尾。片段、技能、提示词和示例代码为本扩展自写。
