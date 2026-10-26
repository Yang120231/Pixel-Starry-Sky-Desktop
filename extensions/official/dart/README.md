# Dart 与 Flutter 支持

Dart 的语法高亮、常用代码片段、Dart / Flutter 项目任务，以及写测试、查报错的技能和提示词。

## 装上以后

- **代码片段**（`.dart` 文件里输入前缀，共 34 条）：

| 前缀 | 作用 |
| --- | --- |
| `main` / `amain` | main 函数 / async main |
| `class` `abstract` `enum` `enumx` `ext` `mixin` | 类、抽象类、枚举、增强枚举、扩展方法、mixin |
| `ctor` `factory` `tojson` `get` `set` | 命名构造函数、工厂构造函数（fromJson）、toJson、getter、setter |
| `fori` `forin` `ifelse` `switch` `trycatch` | for 循环、for-in、if/else、switch 表达式、try/on/catch |
| `afn` `stream` | 返回 Future 的异步函数、async* 生成 Stream |
| `stless` `stful` `initstate` `dispose` `setstate` | Flutter 无状态组件、有状态组件、initState、dispose、setState |
| `scaffold` `listb` `futureb` `streamb` | Scaffold 页面、ListView.builder、FutureBuilder、StreamBuilder |
| `test` `group` `testw` `throws` | 测试用例、分组、testWidgets、断言抛错 |
| `pr` | 带变量名的 print |

- **任务**：认 `pubspec.yaml`。`pubspec.yaml` 里有 `flutter:`（含 `sdk: flutter`）时按 Flutter 项目列出 `flutter pub get` / `upgrade` / `outdated`、`flutter test`、`flutter analyze`、`flutter run`；否则按纯 Dart 项目列出 `dart pub get` / `upgrade` / `outdated`、`dart test`、`dart analyze`、`dart run`。两种项目都有 `dart format .`；`pubspec.yaml` 里有 `build_runner` 时多出 `dart run build_runner build` 和 `watch`（带 `--delete-conflicting-outputs`）。
- **技能**：`dart-project`，Claude Code 里是 `/ext-pixelsky-dart:dart-project`，Codex 里是 `$dart-project`。教 AI 先认是 Dart 还是 Flutter、用项目自己的工具链，按 pub、`dart format`、`dart analyze`、`flutter test`、`build_runner` 的顺序验证改动，并列出常见报错的处理思路。
- **提示词**（输入框「/」菜单里都有；需要选中代码的几条在编辑器右键里也有）：为选中代码写 Dart 测试、解释 Dart / Flutter 报错、整理空安全写法、补全文档注释。
- **语法高亮**：软件没有内置的 Dart 高亮，装上这个扩展后 `.dart` 文件直接使用扩展自带的 TextMate 语法，无需设置。

## 已知问题

- 语法没有代码折叠。
- 任务只认 `pubspec.yaml`，只找根目录往下 3 层，且跳过 `build`、`.dart_tool` 等目录。
- 是否 Flutter 项目只看 `pubspec.yaml` 全文里有没有 `flutter:`；`environment:` 下写了 `flutter: ">=3.0.0"` 的纯 Dart 包也会被当作 Flutter 项目。monorepo 里每个 `pubspec.yaml` 各自判断，任务在各自的文件夹里运行。
- 用 FVM 的项目需要自己在终端里加 `fvm` 前缀，任务直接调用 PATH 里的 `dart` / `flutter`。
- `build_runner` 任务靠 `pubspec.yaml` 全文里有没有 `build_runner` 判断。
- 语法来自上游原样，没有逐项核对 Dart 3 的新写法（records、patterns 等），个别地方可能着色不全。

## 来源和许可证

本扩展按 MIT 许可发布。语法文件 `syntaxes/dart.tmLanguage.json` 来自 dart-lang/dart-syntax-highlight 的 `grammars/dart.json`，许可证为 BSD-3-Clause；具体来源地址和提交号见 `SOURCE.md`，版权声明和许可证全文附在 `LICENSE` 末尾。片段、技能、提示词和示例代码为本扩展自写。
