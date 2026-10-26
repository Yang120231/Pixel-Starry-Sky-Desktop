---
name: php-project
description: 在 PHP 项目里写代码、跑测试、做静态分析、修报错、装依赖时使用，先认出 Composer 脚本、测试框架和代码风格工具再动手。Use when working in a PHP project: detect Composer scripts, PHPUnit or Pest, PHPStan or Psalm, php-cs-fixer or Pint (and Laravel), then run the project's own checks without switching tools.
---

# PHP 项目工作指南

## 原则

- 先看项目里已有的配置，**用项目自己的工具和脚本**；不擅自换工具，不擅自加依赖，不擅自升级依赖或改 PHP 版本要求。
- 需要新依赖时先说明理由并征得同意，再用 `composer require 包名`（开发工具加 `--dev`）；不要手改 `composer.lock`，也不要把 `vendor/` 提交进版本库。
- 改了 `composer.json` 的 `autoload` 后运行 `composer dump-autoload`；新增类找不到时先查命名空间、文件名和 PSR-4 映射是否一致。
- `.env` 里有密钥和连接串，不要打印、不要提交；新增配置项写进 `.env.example`。

## 认项目

按下面的线索判断：

| 线索 | 说明 |
| --- | --- |
| `composer.json` 的 `scripts` | 项目约定的命令入口，优先用：`composer run-script 名字`（或 `composer 名字`） |
| `composer.json` 的 `require.php` / `config.platform.php` | 支持的 PHP 版本，新语法不能超过它 |
| `artisan` + `laravel/framework` | Laravel：`php artisan test`、`php artisan migrate`、`php artisan route:list` |
| `bin/console` + `symfony/*` | Symfony：`php bin/console`；测试多半是 PHPUnit |
| `wp-content/`、`wp-config.php` | WordPress，按它的插件和主题约定改，别套框架写法 |
| `phpunit.xml` / `phpunit.xml.dist` | PHPUnit，`vendor/bin/phpunit` |
| `tests/Pest.php` | Pest，`vendor/bin/pest`（Laravel 里 `php artisan test` 也会跑它） |
| `phpstan.neon` / `phpstan.neon.dist` | PHPStan，`vendor/bin/phpstan analyse` |
| `psalm.xml` | Psalm，`vendor/bin/psalm` |
| `.php-cs-fixer.php` / `.php-cs-fixer.dist.php` | php-cs-fixer，`vendor/bin/php-cs-fixer fix` |
| `pint.json`，或 `require-dev` 里有 `laravel/pint` | Pint，`vendor/bin/pint` |
| `phpcs.xml` | PHP_CodeSniffer，`vendor/bin/phpcs` / `phpcbf` |

命令前缀：项目的二进制在 `vendor/bin/` 下，用 `vendor/bin/工具名`（Windows 的 PowerShell 里写 `vendor\bin\工具名`，或直接用 `composer exec 工具名`）；全局安装的版本可能和项目不一致，别用。

## 验证改动

只跑项目里有的，先快后慢：

1. 先看 `composer.json` 的 `scripts`：有 `test`、`lint`、`analyse`、`check` 这类脚本就直接用，它们已经带好了项目要求的参数。
2. 语法检查：改了单个文件可以 `php -l 文件路径`。
3. 代码风格：Pint 先 `vendor/bin/pint --test` 看差异，确认后 `vendor/bin/pint` 修；php-cs-fixer 先 `vendor/bin/php-cs-fixer fix --dry-run --diff`，再去掉 `--dry-run`。用哪个看项目有哪个配置，不要换。
4. 静态分析：`vendor/bin/phpstan analyse`（路径和级别以 `phpstan.neon` 为准）或 `vendor/bin/psalm`。项目有 baseline 文件时，不要为了过关把新错误加进 baseline，除非用户同意。
5. 测试：
   - 只改了一处时先跑相关的：`vendor/bin/phpunit tests/Unit/FooTest.php`，`--filter 测试方法名` 选单个测试；Pest 用 `vendor/bin/pest tests/Unit/FooTest.php` 或 `--filter`。
   - Laravel：`php artisan test`，`--filter` 同理；需要并行时 `--parallel`。
   - 最后跑一遍完整测试。
6. 对照 `.github/workflows` 或其他 CI 配置，确认 CI 实际跑的命令和参数，本地和它保持一致。

## 常见坑

- `declare(strict_types=1)` 只影响当前文件里发出的调用；项目里多数文件都有它时，新文件也要加。
- PHP 版本低于 8.0 时不要用 `match`、构造器属性提升、联合类型、命名参数；低于 8.1 不要用枚举、`readonly`；低于 8.2 不要用 `readonly class`。
- `==` 会做类型转换，比较用 `===`；`in_array` 和 `array_search` 要传第三个参数 `true`。
- 拼 SQL 一律用预处理语句（PDO 参数绑定、框架的查询构造器），不要拼接用户输入；输出到 HTML 前用 `htmlspecialchars`（Blade 的 `{{ }}` 已经转义，`{!! !!}` 不会）。
- 解码 JSON 加 `JSON_THROW_ON_ERROR`，不要靠 `json_last_error` 事后检查。
- 日期用 `DateTimeImmutable`，并显式指定时区；金额不要用 `float`，用整数分或 `bcmath`。
- Laravel：改了 `.env` 或配置后缓存可能还是旧的，`php artisan optimize:clear`；迁移已经在别处跑过就不要改它，新写一个迁移；测试默认可能连的是开发库，确认 `phpunit.xml` 里的 `DB_*` 环境变量再跑 `migrate:fresh`。
- 跑 `composer update` 会改动很多依赖和锁文件，没有明确要求时只用 `composer install`。
