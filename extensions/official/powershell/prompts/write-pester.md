请为下面这段 {{language}} 代码写 Pester 测试，代码在 {{file}}（项目 {{project}}）：

```
{{selection}}
```

要求：
1. 先看项目里已有的 `*.Tests.ps1`，沿用其 Pester 版本（4 还是 5）、文件位置和写法；找不到就用 Pester 5：`BeforeAll` 里点源或导入被测代码，用 `Describe` / `Context` / `It` 组织。
2. 覆盖正常输入、边界（空值、空集合、带空格或中文的路径）和出错情况（`Should -Throw`）；多组输入用 `-TestCases`。
3. 只替换文件系统、网络、时间这类外部依赖：用 `Mock`，临时文件用 `$TestDrive`；不要真的改用户的文件或注册表。
4. 写完用 `Invoke-Pester -Path <测试文件> -Output Detailed` 跑一遍，报告结果；Pester 没装就告诉我，不要擅自安装。
