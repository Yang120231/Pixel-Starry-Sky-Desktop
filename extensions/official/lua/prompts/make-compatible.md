请检查并改写下面这段 {{language}} 代码，使它能同时在 Lua 5.1 / LuaJIT 和 Lua 5.4 上运行，代码在 {{file}}：

```
{{selection}}
```

要求：
1. 先看项目的 rockspec、`.luarc.json` 或 README 声明的目标版本；如果只面向一个版本（比如 Neovim 的 LuaJIT），就按那个版本检查，不要强行兼容。
2. 逐条列出不兼容点：`unpack` / `table.unpack`、`goto`、位运算符与 `bit` 库、整数除法 `//`、`setfenv` / `getfenv`、`loadstring` / `load` 等。
3. 兼容写法写成 `local unpack = table.unpack or unpack` 这样的小垫片，放在文件开头，不要引入新依赖。
4. 不改变其他行为；改完说明哪些地方没法在两个版本上都验证。
