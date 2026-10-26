# Ruby 支持

Ruby 项目的语法高亮、常用代码片段、Rake 和 Bundler 任务，以及写测试、看异常回溯的技能和提示词。

## 装上以后

- **代码片段**（`.rb` 等 Ruby 文件里输入前缀，共 41 条）：

| 前缀 | 作用 |
| --- | --- |
| `frozen` `req` `reqr` `main` | 魔法注释、require、require_relative、入口守卫 |
| `class` `module` `struct` `data` `error` | 带 initialize 的类、模块、Struct、Data.define、自定义异常 |
| `def` `defs` `defk` `init` `private` `tos` `cmp` | 方法、类方法、关键字参数方法、initialize、private 分区、to_s、Comparable |
| `attr` `attrr` | attr_accessor、attr_reader |
| `if` `ifelse` `unless` `case` `casein` | 条件、case / when、case / in 模式匹配 |
| `each` `eachi` `map` `select` `reduce` | 遍历、转换、过滤、归并 |
| `begin` `rescue` | begin / rescue / ensure、方法体里的 rescue |
| `file` `read` `heredoc` `pr` | 打开文件、读文件、heredoc、带插值的 puts |
| `describe` `it` `raiseerror` `mtest` | RSpec 测试组 / 用例 / 断言抛错、Minitest 测试类 |
| `task` `gem` `group` | Rake 任务、Gemfile 的 gem 行和 group 块 |

- **任务**：
  - 认 `Rakefile`（Rake）：列出写在文件最左边（不缩进）的 `task :名字`、`task "名字"`、`task 名字: [...]`，以及 `Rake::TestTask.new(:名字)`、`RSpec::Core::RakeTask.new(:名字)` 等；紧挨着上一行的 `desc "说明"` 作为任务说明。文件里有 `bundler/gem_tasks` 时多出 `build`、`install`。命令是 `rake 任务名`。
  - 认 `Gemfile`（Bundler）：固定列出 `install`、`update`、`check`、`outdated`（`bundle …`）；同目录有 `spec` 文件夹时多出 `rspec`，`Gemfile` 里提到 `rubocop` 时多出 `rubocop`（`bundle exec …`）；同目录有 `test` 文件夹时多出 `test`（`bundle exec rake test`）。
- **技能**：`ruby-project`，Claude Code 里是 `/ext-pixelsky-ruby:ruby-project`，Codex 里是 `$ruby-project`。教 AI 先认 Bundler / Rake / RSpec / Minitest / RuboCop 和 Ruby 版本管理（rbenv / asdf），用项目自己的命令跑测试和 lint，不擅自升级依赖或换工具。
- **提示词**（输入框「/」菜单和编辑器右键里都有，需要先选中代码）：为选中代码写 RSpec / Minitest 测试、解释 Ruby 异常回溯、按 RuboCop 风格整理选中代码、补 YARD 注释。
- **语法高亮**：软件没有内置 Ruby 高亮，装上后 `.rb`、`.rake`、`.gemspec` 文件以及名为 `Rakefile`、`Gemfile` 的文件会直接用这份语法着色。

## 已知问题

- **Rake 任务命令不带 `bundle exec`**：任务视图的命令模板不能按 `Gemfile.lock` 切换前缀，所以 Rakefile 里的任务都是 `rake 任务名`。项目用 Bundler 锁定了版本、直接 `rake` 报版本冲突时，请在终端里手动加 `bundle exec`；`Gemfile` 那组里的 `rspec`、`rubocop`、`test` 本来就带 `bundle exec`。
- 只列最左边不缩进的 Rake 任务。写在 `namespace` 里的任务（缩进的）不会列出，因为它们的真实名字带命名空间前缀（如 `db:migrate`），而这里无法还原；需要时用 `rake -T` 或手写 `task "db:migrate"` 之类不缩进的形式。
- `Rake::TestTask.new do |t|`（不带名字，默认任务名 `test`）这种写法认不出来，只认带名字的 `Rake::TestTask.new(:名字)`；`bundler/gem_tasks` 提供的 `release` 会推送到 gem 源，所以没有列出。
- `desc` 的说明只取写在一行里的字符串，`desc` 和 `task` 之间有空行或注释时不显示说明（任务本身仍会列出）。
- `bundle update` 会改写 `Gemfile.lock` 里的很多版本，点之前请确认。
- 语法里嵌入的其他语言（heredoc 里的 HTML / SQL / CSS / JavaScript / YAML / 等，对应作用域 `text.html.basic`、`source.sql`、`source.css`、`source.js`、`source.yaml`、`source.shell` 等）软件的高亮引擎里没有，那部分字符串不会上色，按普通字符串显示。
- 语法没有代码折叠。
- `.erb`、`.haml` 等模板文件不在这个扩展的范围内。

## 来源和许可证

本扩展按 MIT 许可发布。语法文件 `syntaxes/ruby.tmLanguage.json` 来自 microsoft/vscode 的 `extensions/ruby`（由 Shopify/ruby-lsp 转换，源头是 rubyide/vscode-ruby、atom/language-ruby 和 TextMate 的 Ruby bundle），许可证为 MIT，其中 TextMate bundle 部分适用 TextMate Bundle License；具体来源地址和提交号见 `SOURCE.md`，版权声明和许可证全文附在 `LICENSE` 末尾。片段、技能、提示词和示例代码为本扩展自写。
