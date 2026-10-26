请加固下面这段 {{language}} 代码，代码在 {{file}}（项目 {{project}}）：

```
{{selection}}
```

要求：
1. 不改变现有功能和参数名；改动前先说明打算改哪几处。
2. 参数加上 `[CmdletBinding()]`、类型和必要的 `[ValidateSet()]` / `[ValidateScript()]` / `[ValidateNotNullOrEmpty()]`；会写文件、删文件或改系统状态的操作加 `SupportsShouldProcess`，用 `$PSCmdlet.ShouldProcess()` 包住，让 `-WhatIf` 生效。
3. 错误处理：需要中止的地方用 `-ErrorAction Stop` 配合 `try` / `catch`；调用外部程序后检查 `$LASTEXITCODE`；路径用 `-LiteralPath` 并避免字符串拼接。
4. 不引入新模块，保持 Windows PowerShell 5.1 也能运行；用了只有 PowerShell 7 才有的语法（`??`、三元、`&&`）要先指出来。
5. 项目里有 PSScriptAnalyzer 配置时，改完用 `Invoke-ScriptAnalyzer` 检查并报告结果。
