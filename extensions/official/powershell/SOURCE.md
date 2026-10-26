# 上游来源

| 文件 | 来源 | 提交 | 许可证 |
| --- | --- | --- | --- |
| `syntaxes/powershell.tmLanguage.json` | https://github.com/microsoft/vscode/blob/af600487b1e94374d9f48f57cbf2cad24656b07f/extensions/powershell/syntaxes/powershell.tmLanguage.json | `af600487b1e94374d9f48f57cbf2cad24656b07f`（microsoft/vscode，该文件最近一次提交，2026-08-11 前后） | MIT |

- 该文件由 VS Code 从 PowerShell/EditorSyntax（https://github.com/PowerShell/EditorSyntax ，`PowerShellSyntax.tmLanguage`，提交 `23eed76d483c887a1608609e9dd57e09666411cc`）转换而来，来源记录见 microsoft/vscode 同目录的 `cgmanifest.json`。
- 语法文件原样使用，未做修改；上游已经是严格 JSON，无需转换。语法内部只引用自身（`$self`），没有引用其他语言。
- 许可证（MIT）全文见 `LICENSE` 末尾的「Third-party notices」。

其余文件（`language-configuration.json`、`samples/`、`snippets/`、`skills/`、`prompts/`、`.fixtures/`）均为本扩展自写。
