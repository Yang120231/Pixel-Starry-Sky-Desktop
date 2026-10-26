我在项目 {{project}} 里遇到了一个 Dart / Flutter 报错，完整的报错信息和堆栈（`dart analyze` 的输出、编译错误，或运行时从 `══╡ EXCEPTION CAUGHT BY ... ╞══` 开始的那一段）附在下面；如果下面还没有，请先让我贴出来，再按这个顺序帮我处理：

1. 用一两句话说明这个报错是什么意思，真正出错的是哪一层（先看第一条 error 和最靠近我们自己代码的那一帧，不要被框架内部的帧带偏）。
2. 到项目里打开对应的文件和行，结合代码判断根本原因；信息不够时先告诉我还需要什么（Dart / Flutter 版本、触发步骤、`pubspec.yaml`），不要凭空猜。
3. 给出最小的修复，改之前说明会动哪些文件；不要顺手重构，不要为了绕过报错去加 `// ignore:`、`!`、`dependency_overrides` 或新依赖。
4. 用项目自己的命令验证（`dart analyze` / `flutter analyze`，以及出错场景对应的 `dart test` / `flutter test`），告诉我结果；改了带 `part` 的源文件时别忘了重新运行 build_runner。
