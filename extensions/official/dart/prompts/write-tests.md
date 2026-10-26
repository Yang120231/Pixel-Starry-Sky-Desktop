请为下面这段 {{language}} 代码写测试，代码在 {{file}}（项目 {{project}}）：

```
{{selection}}
```

要求：
1. 先看 `pubspec.yaml` 判断是纯 Dart 还是 Flutter：纯 Dart 用 `package:test`，Flutter 的组件用 `flutter_test` 的 `testWidgets`。沿用项目 `test/` 目录里已有的结构、命名（`xxx_test.dart`）和已有的 mock 库（mocktail / mockito），不要新装测试库。
2. 覆盖正常路径、边界值和出错路径；多组输入用循环生成用例，共用的准备放进 `setUp`，异常用 `throwsA(isA<...>())` 断言；异步测试用 `async` / `await`，不要用固定延时。
3. 一个测试只验证一件事，名字写清楚场景；不要 mock 被测代码本身，只替换网络、时间、文件系统这类外部依赖。
4. 写完后用项目自己的命令运行这些测试（`dart test 文件路径` 或 `flutter test 文件路径`），把结果告诉我；如果发现被测代码本身有问题，先说明，不要悄悄改它。
