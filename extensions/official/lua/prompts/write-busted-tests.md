请为下面这段 {{language}} 代码写 busted 测试，代码在 {{file}}：

```
{{selection}}
```

要求：
1. 先看项目里 `spec/` 或 `tests/` 已有的测试风格、`.busted` 配置和断言写法（`assert.are.equal`、`assert.same` 等），保持一致；项目用的不是 busted（比如 plenary、luaunit）就用项目自己的。
2. 覆盖正常路径、边界（空表、`nil`、空字符串）和会抛错的情况（用 `assert.has_error`）。
3. 用 `describe` / `it` 分组，用例名写清楚行为；需要隔离外部依赖时用 `before_each` 和 stub，不要碰真实文件和网络。
4. 只新增测试文件，不改被测代码；写完说明怎么运行（例如 `busted spec/xxx_spec.lua`）。
