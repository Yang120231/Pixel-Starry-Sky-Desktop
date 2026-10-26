请给下面这段 {{language}} 代码补全类型声明，代码在 {{file}}：

```php
{{selection}}
```

要求：
1. 只补类型，不改变运行行为，不改函数逻辑和命名。
2. 先看项目支持的 PHP 版本（composer.json 的 `require.php`）：8.0 起可以用联合类型、`mixed`；8.1 起可以用 `readonly` 属性、`never`；版本更低时不要用这些写法。
3. 参数、返回值和属性都补上原生类型；原生类型表达不了的（数组元素类型、泛型、数组形状）用 PHPDoc 补充，例如 `@param array<string, int> $map`、`@return list<User>`。
4. 看不准的类型先问我，不要用 `mixed` 糊弄；如果项目开了 `declare(strict_types=1)`，注意调用方传参是否会因此报错，并指出来。
