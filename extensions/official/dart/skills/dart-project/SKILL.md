---
name: dart-project
description: 在 Dart 或 Flutter 项目里写代码、跑测试、修分析和编译报错、处理依赖与代码生成时使用。Use when working in a Dart or Flutter project: detect Dart vs Flutter, use pub, dart format, dart analyze, flutter test and build_runner without switching tools.
---

# Dart / Flutter 项目工作指南

## 原则

- 先看 `pubspec.yaml`、`pubspec.lock`、`analysis_options.yaml` 和 CI 配置，**用项目自己的工具和版本**；不擅自升级依赖、改 SDK 约束（`environment:`）或加新包。
- 需要新依赖时先说明理由并征得同意，再用 `dart pub add 包名` / `flutter pub add 包名`（开发依赖加 `--dev`），不要手改 `pubspec.lock`。
- 项目用 FVM（有 `.fvmrc` 或 `.fvm/`）时，命令前加 `fvm`（`fvm flutter test`），用项目锁定的 Flutter 版本。
- 生成的文件（`*.g.dart`、`*.freezed.dart`、`*.mocks.dart`）不手改，改源文件后重新生成。

## 认是 Dart 还是 Flutter

| 线索 | 类型 | 命令前缀 |
| --- | --- | --- |
| `pubspec.yaml` 里有 `flutter:` 段或 `sdk: flutter` | Flutter 应用或包 | `flutter` |
| 否则 | 纯 Dart 包或命令行程序 | `dart` |

- Flutter 项目里也可以用 `dart format`、`dart run`；但获取依赖、跑测试、静态分析优先用 `flutter pub get`、`flutter test`、`flutter analyze`，它们会带上 Flutter SDK 的环境。
- 一个仓库里可能有多个 `pubspec.yaml`（monorepo，常配合 Melos：有 `melos.yaml` 时用 `melos bootstrap` / `melos run`）。命令要在目标包的目录里运行。

## 验证改动

按项目实际配置，先快后慢：

1. 依赖：`dart pub get` / `flutter pub get`（改了 `pubspec.yaml` 之后）。
2. 格式化：`dart format .`（只检查用 `dart format --output=none --set-exit-if-changed .`）。行宽以 `analysis_options.yaml` 里 `formatter: page_width` 为准。
3. 静态分析：`dart analyze` / `flutter analyze`。规则来自 `analysis_options.yaml`（常见是 `flutter_lints` 或 `lints`）；`--fatal-infos` 是否启用看 CI。不要为了通过检查加 `// ignore:`，先修真正的问题。
4. 测试：`dart test` / `flutter test`。只改一处时指定文件 `flutter test test/foo_test.dart`，用 `--name "关键字"` 选单个用例，`--plain-name` 精确匹配；集成测试在 `integration_test/`，用 `flutter test integration_test`（需要设备或模拟器）。
5. 代码生成：用了 `build_runner` 的项目（`pubspec.yaml` 的 dev_dependencies 里有它），改了带 `part '*.g.dart'` 的源文件或注解后运行 `dart run build_runner build --delete-conflicting-outputs`；开发时可以 `dart run build_runner watch`。

## 修报错

- 先读第一条 error 而不是最后一条，后面的往往是它引发的。`dart analyze` 的信息带规则名（如 `unused_import`），照规则名去查。
- `Null check operator used on a null value`：别简单地删掉 `!`，先弄清值为什么可能为空，用 `?.`、`??`、提前返回或把类型改成非空；少用 `late` 和 `!` 绕过。
- `setState() called after dispose()`：异步回调后先检查 `if (!mounted) return;`，并在 `dispose()` 里取消 Timer、订阅和控制器。
- `A RenderFlex overflowed` / 无界约束报错：多半是 `Column` / `Row` / `ListView` 嵌套造成，用 `Expanded`、`Flexible` 或给 `ListView` 设 `shrinkWrap` 解决。
- `BuildContext` 跨异步间隙使用（`use_build_context_synchronously`）：在 `await` 之后先 `if (!context.mounted) return;`。
- 依赖版本冲突（`version solving failed`）：用 `dart pub deps` / `flutter pub outdated` 看是谁约束了版本，调整约束，不要无脑加 `dependency_overrides`。
- 生成代码报找不到 `_$Xxx`：多半是没跑 `build_runner` 或 `part` 声明文件名写错。

## 写测试

- 沿用项目已有的目录和命名：测试放 `test/`，文件名以 `_test.dart` 结尾，镜像 `lib/` 的结构。
- 纯 Dart 用 `package:test`；Flutter 用 `flutter_test`（`testWidgets`、`WidgetTester.pumpWidget`、`find.text`）。多组输入用循环生成 `test(...)`，共用准备代码放 `setUp`。
- 断言异常用 `expect(() => f(), throwsA(isA<StateError>()))`；异步用 `async` / `await`，不要用固定的延时等待，Flutter 里用 `await tester.pumpAndSettle()`。
- 只替换网络、时间、文件系统这类外部依赖；项目里已有 `mocktail` 或 `mockito` 就沿用，不引入第二个。

## 常见坑

- 路径用 `package:path` 的 `p.join`，不要手拼分隔符；Windows 上换行和路径分隔符不同。
- 用了 Dart 3 的新语法（records、patterns、`switch` 表达式、`sealed`）之前，先确认 `environment: sdk:` 的下限 `>=3.0.0`。
- `pubspec.yaml` 里 `assets:`、`fonts:` 缩进必须是空格；改完要 `flutter pub get`。
- 不要提交 `build/`、`.dart_tool/`；应用类项目提交 `pubspec.lock`，库类项目通常不提交。
