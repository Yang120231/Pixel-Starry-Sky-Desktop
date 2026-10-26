请为下面这段 PHP 代码（文件 {{file}}，项目 {{project}}）写单元测试。

要求：
1. 先看项目里已有的测试：用的是 PHPUnit 还是 Pest（看 composer.json 的 require-dev 和 tests/ 目录），沿用它们的写法、命名空间和目录结构，不要擅自引入新的测试依赖。
2. 覆盖正常路径、边界值（null、空数组、空字符串、0、负数）和会抛出异常的路径。
3. 测试名要说清场景和预期，每个测试只验证一件事；多组输入用数据提供器（PHPUnit）或 dataset（Pest）。
4. 写完后用项目自己的方式运行（composer.json 的 scripts 里有 test 就用 composer test，否则 vendor/bin/phpunit 或 vendor/bin/pest；Laravel 项目用 php artisan test），失败时先弄清原因再修，不要为了通过而改被测代码。

被测代码：

```php
{{selection}}
```
