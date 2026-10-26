请用较新的 PHP 语法改写下面这段代码，代码在 {{file}}：

```php
{{selection}}
```

要求：
1. 先看项目支持的 PHP 版本（composer.json 的 `require.php`、CI 配置），**只用该版本支持的语法**。
2. 可以考虑的改写：构造器属性提升（8.0）、`match` 代替冗长的 `switch`（8.0）、空安全运算符 `?->`（8.0）、命名参数（8.0）、枚举代替一组常量（8.1）、`readonly` 属性（8.1）、一等可调用语法 `strlen(...)`（8.1）、`str_contains` / `str_starts_with` 代替 `strpos`。
3. 保持行为不变，不顺手改函数签名和公开接口；改动较大的地方说明理由。
4. 改完用项目自己的测试和静态检查验证（composer 脚本、vendor/bin/phpunit、vendor/bin/phpstan 等）。
