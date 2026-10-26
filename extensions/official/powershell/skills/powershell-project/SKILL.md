---
name: powershell-project
description: 在 PowerShell 项目里写脚本、模块，跑 Pester 测试和 PSScriptAnalyzer，处理 5.1 与 7 的差异、执行策略和模块清单时使用。Use when working in a PowerShell project: .ps1 / .psm1 / .psd1 files, Pester tests, PSScriptAnalyzer, module manifests, Windows PowerShell 5.1 vs PowerShell 7 differences, execution policy.
---

# PowerShell 项目工作流

## 原则

- 先看项目里已有的脚本、`.psd1`、CI 配置和 `PSScriptAnalyzerSettings.psd1`，**沿用项目的写法和工具**；不擅自装模块、不升级模块、不改执行策略。
- 需要新模块时先说明理由并征得同意。项目若用 `RequiredModules`、`requirements.psd1`（PSDepend）或 `Install-PSResource` 管依赖，就走它，不要在脚本里偷偷 `Install-Module`。
- 脚本和模块文件的编码、换行跟项目已有文件保持一致；含中文的 `.ps1` 在 Windows PowerShell 5.1 下需要 UTF-8 **带 BOM** 才不会按系统代码页乱码，PowerShell 7 默认 UTF-8。

## 认清运行环境

| 线索 | 说明 |
| --- | --- |
| `#Requires -Version 7.0`、`.psd1` 里 `PowerShellVersion` / `CompatiblePSEditions = 'Core'` | 只面向 PowerShell 7（`pwsh`） |
| `CompatiblePSEditions = @('Desktop','Core')` 或没写版本 | 要同时兼容 Windows PowerShell 5.1（`powershell.exe`）和 7 |
| CI 里有 `shell: pwsh` / `shell: powershell` | 以 CI 为准 |

先 `$PSVersionTable.PSVersion` 和 `$PSVersionTable.PSEdition` 看当前是哪个。

**5.1 与 7 的常见差异**（要兼容 5.1 的项目不要用右边这些）：

- 管道链 `&&` / `||`、三元 `? :`、空值合并 `??` / `??=`、`ForEach-Object -Parallel`、`$PSStyle`、`Get-Error`，5.1 都没有。
- `Out-File` / `>` / `Set-Content` 的默认编码：5.1 是 UTF-16LE 或系统代码页，7 是无 BOM 的 UTF-8；要确定就显式写 `-Encoding utf8`（5.1 的 `utf8` 带 BOM，7 的不带；要不带 BOM 的需要 7 的 `utf8NoBOM` 或 .NET API）。
- `ConvertTo-Json` 默认 `-Depth 2`，深层对象会被截断成字符串，要写 `-Depth`。`ConvertFrom-Json -AsHashtable` 只有 7 有。
- `Invoke-WebRequest` 在 5.1 里默认走 IE 引擎解析，加 `-UseBasicParsing`；`-SkipCertificateCheck`、`-Authentication` 只有 7 有。
- 5.1 只有 Windows；需要跨平台的脚本用 `$IsWindows` / `$IsLinux` / `$IsMacOS`（7 才有），路径用 `Join-Path`，不要写死 `\`。

## 验证改动

按项目已配置的检查，先快后慢，只跑项目里有的：

1. **语法**：`[System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$errors)`，或直接 `pwsh -NoProfile -File 脚本` 跑一遍（对有副作用的脚本先用 `-WhatIf`）。
2. **静态检查**：`Invoke-ScriptAnalyzer -Path . -Recurse`；项目里有 `PSScriptAnalyzerSettings.psd1` 就加 `-Settings`。不要为了让检查通过全局关规则，确需例外就在代码处用 `[Diagnostics.CodeAnalysis.SuppressMessageAttribute()]` 并写明原因。
3. **测试**：Pester。先 `Get-Module Pester -ListAvailable` 看版本，4 和 5 的写法不同（5 的 `Describe` 外的代码在发现阶段运行，初始化要放进 `BeforeAll`）。命令：`Invoke-Pester -Path ./tests -Output Detailed`，只跑一处时用 `-Path 文件` 或 `-FullNameFilter '*关键字*'`；CI 里用 `-CI`。
4. **模块清单**：改了导出的函数就同步 `.psd1` 的 `FunctionsToExport`（别用 `'*'`）；`Test-ModuleManifest ./Foo.psd1` 校验清单，`Import-Module ./Foo.psd1 -Force` 看能否加载。
5. 项目有 `build.ps1`、`psakefile.ps1`、`*.build.ps1`（Invoke-Build）时，按它们的任务入口跑完整流程，不自己拼一套。

## 执行策略与安全

- 在 Windows 上脚本被拒绝执行（`running scripts is disabled` / 无法加载，因为在此系统上禁止运行脚本）时，是执行策略的问题。**不要**默认建议 `Set-ExecutionPolicy Unrestricted`；临时运行用 `powershell -ExecutionPolicy Bypass -File 脚本.ps1`（只对这个进程生效），长期设置用 `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser`，并先让用户确认。
- 从网上下载的脚本带有"来自 Internet"标记，确认来源后用 `Unblock-File` 解除，不要整个目录批量解除。
- 不用 `Invoke-Expression` 执行拼出来的字符串；调用外部程序用 `& $exe @args`（参数数组），不拼成一条命令字符串。
- 不在脚本里写明文密码或令牌，用 `SecretManagement`、环境变量或 `Get-Credential`。

## 常见坑

- 文件和路径：含 `[` `]` 的路径用 `-LiteralPath`；读文本显式 `-Encoding`；`Get-Content` 逐行读大文件，一次读整份用 `-Raw`。
- 函数的返回值是**所有**未被捕获的输出，不只是 `return` 的那个：不需要的输出用 `$null =` 或 `[void]` 丢掉（`List.Add()`、`New-Item` 等）。
- 单个结果可能不是数组：对可能返回 0 或 1 个对象的命令，用 `@(...)` 包起来再取 `.Count`。
- `-eq` 等比较运算符默认不区分大小写，左侧是数组时返回匹配的元素而不是 True / False；和 `$null` 比较要把 `$null` 放左边。
- 外部程序的失败不会触发 `try/catch`，要检查 `$LASTEXITCODE`；5.1 里用 `2>&1` 重定向原生命令的 stderr 会变成错误记录，在 `$ErrorActionPreference = 'Stop'` 下直接终止脚本，7.4+ 才有 `$PSNativeCommandUseErrorActionPreference` 控制退出码是否算错误。
- 引号：单引号不展开变量，双引号里取属性要写 `"$($obj.Name)"`；正则和路径优先用单引号。
- 脚本里用 `$PSScriptRoot` 找相邻文件，不依赖当前目录；函数里不要改调用者的 `$ErrorActionPreference` 却不还原。
- 模块里的函数要用 `Export-ModuleMember` 或清单控制导出；私有函数不导出，测试私有函数用 `InModuleScope`。
