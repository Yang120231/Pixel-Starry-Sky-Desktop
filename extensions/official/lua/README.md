# Lua 支持

Lua 的语法高亮、常用代码片段，以及 luarocks / busted / luacheck 项目、Neovim 插件和 LÖVE 游戏脚本的技能与提示词。

## 装上以后

- **代码片段**（`.lua` 文件里输入前缀，共 33 条）：

| 前缀 | 作用 |
| --- | --- |
| `loc` `fn` `lfn` `method` `afn` | local 变量、函数、local 函数、冒号方法、匿名函数 |
| `if` `ifelse` `ifelif` | 条件分支 |
| `fori` `ipairs` `pairs` `while` `repeat` | 各种循环 |
| `req` `module` | require、返回表的模块骨架 |
| `class` `inherit` `tostr` | 基于元表的类、单继承、`__tostring` |
| `pcall` `xpcall` `err` `assert` | 保护调用、带堆栈的保护调用、抛错、断言 |
| `printf` `tins` `tsort` `split` | 格式化打印、table.insert、table.sort、按分隔符切字符串 |
| `readfile` `writefile` | 整个文件读 / 写 |
| `ann` | LuaLS 的 `---@param` / `---@return` 注解 |
| `describe` | busted 的 describe / it |
| `love` | LÖVE 的 load / update / draw 回调 |
| `nvimplugin` `keymap` | Neovim 插件 `setup` 骨架、`vim.keymap.set` |

- **任务**：本扩展不提供任务模板（Lua 项目没有统一的任务入口，命令请看项目自己的 Makefile 或 CI）。
- **技能**：`lua-project`，Claude Code 里是 `/ext-pixelsky-lua:lua-project`，Codex 里是 `$lua-project`。教 AI 先判断运行时是标准 Lua 还是 LuaJIT（Neovim、LÖVE）、认 luarocks / busted / luacheck / StyLua，用项目自己的命令验证，并避开 `local`、`.` 与 `:`、`pairs` 顺序等常见坑。
- **提示词**（输入框「/」菜单和编辑器右键里都有，需要先选中代码）：为选中代码写 busted 测试、解释 Lua 报错、补 LuaLS 类型注解、兼容 Lua 5.1 与 5.4。
- **语法高亮**：软件内置没有 Lua 的高亮，装上本扩展后 `.lua` 文件自动用这份 TextMate 语法着色，不需要额外开关。

## 已知问题

- 语法没有代码折叠。
- LuaJIT 的 `ffi.cdef([[ ... ]])` 里的 C 声明，语法会交给 C 语法着色；软件的语法引擎里没有 `source.c`，这部分不会上色，显示成普通文字。其余字符串、注释、函数等不受影响。
- 只识别 `.lua` 扩展名；`.rockspec`、`.luacheckrc`、`.busted` 等配置文件（本质是 Lua）不会着色。
- 不提供任务模板。

## 来源和许可证

本扩展按 MIT 许可发布。语法文件 `syntaxes/lua.tmLanguage.json` 来自 microsoft/vscode 的 `extensions/lua`（由 sumneko/lua.tmbundle 转换），许可证为 TextMate Bundle License；具体来源地址和提交号见 `SOURCE.md`，版权声明和许可证全文附在 `LICENSE` 末尾。片段、技能、提示词和示例代码为本扩展自写。
