# PHP 支持

PHP 项目的语法高亮、常用代码片段、Composer 脚本和 Laravel Artisan 任务，以及写 PHPUnit / Pest 测试、看报错堆栈的技能和提示词。

## 装上以后

- **代码片段**（`.php` 文件里输入前缀，共 38 条）：

| 前缀 | 作用 |
| --- | --- |
| `phpf` | 文件头：`<?php`、`strict_types`、命名空间 |
| `class` `interface` `trait` `enum` `readonly` | 最终类、接口、trait、带值枚举、只读类（名称默认取文件名） |
| `ctor` `method` `smethod` `prop` `const` | 构造方法（属性提升）、方法、静态方法、属性、类常量 |
| `fn` `arrow` `closure` | 带类型的函数、箭头函数、匿名函数 |
| `if` `ifelse` `foreach` `foreachk` `for` `switch` `match` | 控制流 |
| `trycatch` `tryfinally` `throw` | 异常 |
| `arrmap` `arrfilter` `jsonenc` `jsondec` | 数组映射 / 过滤、JSON 编码 / 解码（失败时抛异常） |
| `pdoquery` | PDO 预处理查询 |
| `doc` `dump` `errlog` | PHPDoc、`var_dump`、`error_log` |
| `testclass` `test` `dataprovider` `expectex` | PHPUnit 测试类、测试方法、数据提供器、断言抛错 |
| `pest` | Pest 测试用例 |
| `route` | Laravel 路由 |

- **任务**：认 `composer.json`，列出三组：
  - **Composer 脚本**：`scripts` 里的每个脚本，命令是 `composer run-script 脚本名`。
  - **Laravel Artisan**：只在 `composer.json` 同一文件夹里有 `artisan` 文件时出现，列 `serve`、`test`、`migrate`、`migrate:fresh`、`migrate:rollback`、`db:seed`、`route:list`、`queue:work`、`schedule:work`、`storage:link`、`optimize:clear`，命令是 `php artisan 名字`。
  - **Composer**：`install`、`update`、`dump-autoload`、`validate`。
- **技能**：`php-project`，Claude Code 里是 `/ext-pixelsky-php:php-project`，Codex 里是 `$php-project`。教 AI 先认 Composer 脚本、PHP 版本要求、PHPUnit / Pest、PHPStan / Psalm、php-cs-fixer / Pint，用项目自己的命令验证改动，不擅自换工具或加依赖。
- **提示词**（输入框「/」菜单和编辑器右键里都有，需要先选中代码）：为选中代码写 PHPUnit / Pest 测试、解释 PHP 报错或堆栈、补类型声明、用新语法改写选中代码。
- **语法高亮**：软件没有内置的 PHP 高亮，装上这个扩展后 `.php` 和 `.phtml` 文件就会上色。语法文件没有代码折叠。

## 已知问题

- PHP 文件里嵌的 HTML、CSS、JavaScript、SQL、XML、JSON 片段（语法文件通过 `text.html.basic`、`source.css`、`source.js`、`source.sql`、`text.xml`、`source.json` 引入）不会上色，因为软件的语法引擎里没有这些语法；`<?php … ?>` 里的 PHP 代码不受影响。
- Composer 脚本靠正则读 `composer.json` 的 `scripts` 对象：脚本的值里含有 `{` 或 `}`（比如命令行里的 JSON）时，排在它后面的脚本取不到；`scripts-descriptions` 里的说明不会读出来，脚本也不带描述。
- 事件脚本（如 `post-autoload-dump`）也会列出来，用 `composer run-script` 运行时会直接执行里面的命令。
- Laravel Artisan 的任务是固定的一组常用命令，不会读取项目里自定义的 Artisan 命令；`make:*` 这类需要参数的命令没有列出，请在终端里运行。
- 任务视图只找根目录往下 3 层，且跳过 `vendor`、`node_modules`、`build` 等目录。

## 来源和许可证

本扩展按 MIT 许可发布。语法文件 `syntaxes/php.tmLanguage.json` 来自 microsoft/vscode 的 `extensions/php`（由 KapitanOczywisty/language-php 转换，源头是 atom/language-php 和 TextMate 的 PHP bundle），许可证为 MIT，并随附 TextMate bundle 的许可声明；具体来源地址和提交号见 `SOURCE.md`，版权声明和许可证全文附在 `LICENSE` 末尾。片段、技能、提示词和示例代码为本扩展自写。
