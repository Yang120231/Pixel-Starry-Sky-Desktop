# C# 支持

给 C#（`.cs`、`.csx`）文件加上语法高亮、常用代码片段、dotnet 任务，以及写测试、处理 nullable 警告的技能和提示词。

## 装上以后

- **代码片段**（语言 `csharp`）：

| 前缀 | 作用 |
| --- | --- |
| `main` / `tlmain` / `webapp` | Main 入口方法 / 顶层语句 / ASP.NET Core 应用骨架 |
| `class` / `sclass` / `interface` / `enum` | 类 / 密封类 / 接口 / 枚举 |
| `record` / `recstruct` | 位置记录 / readonly record struct |
| `prop` / `propi` / `propr` | 属性 get; set; / get; init; / required 属性 |
| `ctor` / `atask` / `extm` | 构造函数 / 异步方法（带 CancellationToken）/ 扩展方法 |
| `xfact` / `xtheory` / `xfacta` | xUnit：Fact / Theory + InlineData / 异步 Fact |
| `ntest` / `ntestcase` | NUnit：Test / TestCase（只在 NUnit 项目里用） |
| `usingb` / `usingd` / `ausing` | using 块 / using 声明 / await using |
| `linq` / `linqq` | LINQ 方法链 / 查询语法 |
| `swe` / `ispat` / `isprop` | switch 表达式 / is 类型模式 / is 属性模式 |
| `logger` / `logi` | 注入 ILogger<T> / 结构化日志调用 |
| `mapget` / `mappost` | Minimal API 的 GET / POST 端点 |
| `nullchk` / `trycatch` / `aforeach` | ArgumentNullException.ThrowIfNull / try catch / await foreach |

- **任务**：按项目文件认，需要像素星空 0.6.2 及以上（根目录往下 3 层，每个文件各列一组）：
  - `*.sln` / `*.slnx`（解决方案）：`build`、`test`、`restore`、`format`，分别运行 `dotnet build <文件>`、`dotnet test <文件>`、`dotnet restore <文件>`、`dotnet format <文件>`。
  - `*.csproj`（项目）：`build` 运行 `dotnet build <文件>`；项目文件里引用了 `Microsoft.NET.Test.Sdk`（测试项目）时多一个 `test`，运行 `dotnet test <文件>`。
  - `*.csproj` 的 `run`：项目文件里有 `<OutputType>Exe`（控制台 / 桌面程序）或用 `Microsoft.NET.Sdk.Web`（Web 项目）时列出，运行 `dotnet run --project <文件>`。
  - 命令都带上项目 / 解决方案文件的路径，在工作区根目录执行，所以同一个文件夹里有多个项目也不会报"找到多个项目或解决方案文件"。
- **技能**：`csharp-project`，Claude Code 里是 `/ext-pixelsky-csharp:csharp-project`，Codex 里是 `$csharp-project`。教 AI 认解决方案和项目文件、用 dotnet CLI 验证改动、沿用项目的测试框架、认真处理 nullable 警告，不擅自换工具或装新依赖。
- **提示词**（输入框「/」菜单；需要选中代码的三条在编辑器右键里也有）：
  - 为选中代码写单元测试（沿用项目现有测试框架）
  - 处理 nullable 警告（不用 `!` 压警告）
  - 解释异常和堆栈（只在输入框）
  - 改成 async/await
- **语法高亮**：默认仍用内置的 C# 高亮（内置有代码折叠）。想换成这个扩展的语法，到 设置 › 扩展 › 已安装 › 本扩展详情里打开「用这个扩展代替内置高亮」；扩展语法没有代码折叠。

## 已知问题

- 任务只认 `*.csproj`、`*.sln`、`*.slnx`，不认 `*.fsproj`、`*.vbproj`；`run` 只按项目文件里的 `<OutputType>Exe` 和 `Microsoft.NET.Sdk.Web` 判断（只写 `Microsoft.NET.Sdk.Worker` 的后台服务项目不会列出），OutputType 写在 `Directory.Build.props` 里时不会列出 `run`；`test` 只按项目文件里有没有 `Microsoft.NET.Test.Sdk` 判断，该包由 `Directory.Build.props` 统一引入的测试项目不会列出 `test`（可用解决方案的 `test`）。
- 一个仓库既有解决方案又有项目文件时，两级任务都会列出（解决方案级和每个项目各一组）；多目标框架的项目要加 `--framework` 时请在终端里手动运行。
- 软件只往下找 3 层，更深的项目文件找不到；`dotnet format` 需要 .NET 6 及以上的 SDK。
- 扩展语法没有代码折叠，也不会按语义区分类型和变量（TextMate 语法只做词法着色）。
- `.csx` 脚本只有 C# 语法着色，没有别的支持。

## 来源和许可证

语法 `syntaxes/csharp.tmLanguage.json` 来自 microsoft/vscode 的 `extensions/csharp`（由 dotnet/csharp-tmLanguage 转换而来），MIT 许可证，原样未改动；来源地址、提交号见 SOURCE.md，版权声明和许可证全文见 LICENSE 末尾「Third-party notices」。片段、技能、提示词、示例由像素星空编写，MIT 许可证。
