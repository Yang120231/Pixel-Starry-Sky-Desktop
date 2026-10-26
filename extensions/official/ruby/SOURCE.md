# 上游来源

| 文件 | 来源 | 提交 | 许可证 |
| --- | --- | --- | --- |
| `syntaxes/ruby.tmLanguage.json` | https://github.com/microsoft/vscode/blob/af600487b1e94374d9f48f57cbf2cad24656b07f/extensions/ruby/syntaxes/ruby.tmLanguage.json | `af600487b1e94374d9f48f57cbf2cad24656b07f`（microsoft/vscode，该文件最近一次提交，2026-08-11） | MIT；源头 TextMate Ruby bundle 为 TextMate Bundle License |

- 该文件由 VS Code 从 Shopify/ruby-lsp（https://github.com/Shopify/ruby-lsp ，提交 `e044408a069f43c892143f19c389628eebffbd01`，`vscode/grammars/ruby.cson.json`，MIT）转换而来，来源记录见 microsoft/vscode 同目录上一级的 `cgmanifest.json`。
- 更早的源头是 rubyide/vscode-ruby、atom/language-ruby（均为 MIT）和 TextMate 的 ruby.tmbundle（https://github.com/textmate/ruby.tmbundle ，TextMate Bundle License）。各自的许可见 `LICENSE` 末尾的「Third-party notices」。
- 语法文件原样使用，未做修改。

其余文件（`language-configuration.json`、`samples/`、`snippets/`、`skills/`、`prompts/`、`.fixtures/`）均为本扩展自写。
