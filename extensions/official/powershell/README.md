# PowerShell 支持

PowerShell 脚本和模块的语法高亮、常用代码片段、psake 任务，以及写 Pester 测试、查脚本报错的技能和提示词。

## 装上以后

- **代码片段**（`.ps1` / `.psm1` / `.psd1` 文件里输入前缀，共 39 条）：

| 前缀 | 作用 |
| --- | --- |
| `func` `advfunc` `param` `paramv` | 简单函数、带 CmdletBinding 和管道输入的高级函数、param 块、带校验特性的参数 |
| `script` `strict` | 脚本开头（`#Requires`、严格模式、遇错即停）、严格模式 |
| `if` `ifelse` `switch` `for` `while` `foreach` `feo` `wo` | 条件、循环、`ForEach-Object`、`Where-Object` |
| `trycatch` `tryfinally` `native` | try/catch、try/catch/finally、运行外部程序并检查退出码 |
| `class` `enum` `hash` `pso` `splat` | 类、枚举、哈希表、`[pscustomobject]`、参数展开 |
| `here` `hereexp` `region` `help` | here-string（字面 / 可展开）、折叠区域、基于注释的帮助 |
| `import` `root` `testpath` `joinpath` `readjson` `writejson` | 导入模块、脚本所在目录、路径判断与拼接、读写 JSON |
| `describe` `context` `it` `itcases` `beforeall` `mock` `should` | Pester 5 测试文件、Context、用例、参数化用例、BeforeAll、Mock、Should 断言 |

- **任务**：认 `psakefile.ps1`（psake），把文件里每个 `Task 名称`（也认 `Task -Name 名称`、带引号的名称）列成任务，运行命令是 `powershell -NoProfile -Command "Invoke-psake 任务名"`（Windows）或 `pwsh -NoProfile -Command "Invoke-psake 任务名"`（Linux / macOS）。需要先装好 psake 模块（`Install-Module psake`）。其他构建脚本（`build.ps1`、Invoke-Build 的 `*.build.ps1`）参数各不相同，不在任务里列出，请让 AI 读脚本后再运行。
- **技能**：`powershell-project`，Claude Code 里是 `/ext-pixelsky-powershell:powershell-project`，Codex 里是 `$powershell-project`。教 AI 先认运行环境（Windows PowerShell 5.1 还是 PowerShell 7）、用项目自己的 Pester 和 PSScriptAnalyzer 验证改动、维护模块清单，并避开执行策略、编码、`ConvertTo-Json` 深度等常见坑，不擅自装模块或放宽执行策略。
- **提示词**（输入框「/」菜单和编辑器右键里都有）：为选中代码写 Pester 测试、加固选中的脚本、补全帮助注释（都需要先选中代码）；解释 PowerShell 报错（只在输入框「/」菜单里）。
- **语法高亮**：软件内置没有 PowerShell 的高亮，装上本扩展后 `.ps1`、`.psm1`、`.psd1` 文件直接就有高亮，不需要另外打开开关。

## 已知问题

- 扩展语法没有代码折叠；`#region` / `#endregion` 区域折叠暂不支持。
- psake 任务只认根目录往下 3 层的 `psakefile.ps1`（文件名区分大小写），且只认行首的 `Task`；写在 here-string 里或用变量拼出的任务名认不出来。psake 的 `TaskSetup`、`Properties` 等不是任务，不会列出。
- 任务在 Linux / macOS 上要装有 `pwsh`；Windows 用自带的 `powershell`（5.1），psake 模块要装在它能找到的模块路径里。没有在真实环境里装 psake 跑过 `Invoke-psake`。
- 上游语法对较新的 PowerShell 语法（如 `??`、`?:`、管道链 `&&`）的支持有限，个别写法可能着色不准。

## 来源和许可证

本扩展按 MIT 许可发布。语法文件 `syntaxes/powershell.tmLanguage.json` 来自 microsoft/vscode 的 `extensions/powershell`（由 PowerShell/EditorSyntax 转换），许可证为 MIT；具体来源地址和提交号见 `SOURCE.md`，版权声明和许可证全文附在 `LICENSE` 末尾。片段、技能、提示词和示例代码为本扩展自写。
