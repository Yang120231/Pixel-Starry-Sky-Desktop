---
name: lua-project
description: 在 Lua 项目里写代码、跑测试、修报错时使用，包括判断 Lua 5.1 / 5.4 / LuaJIT 版本、luarocks 依赖、busted 测试、luacheck / StyLua 检查，以及 Neovim 插件和 LÖVE 游戏脚本。Use when working in a Lua project: detecting Lua vs LuaJIT, luarocks, busted, luacheck, StyLua, Neovim plugins, LÖVE games.
---

# Lua 项目工作指南

## 先认运行环境，再写代码

Lua 各版本语法和标准库差别大，**先确定目标运行时，再决定能用什么**：

- `*.rockspec` 里的 `dependencies = { "lua >= 5.1" }` 写明了支持的版本范围。
- Neovim 插件（有 `lua/` 目录、`plugin/`、`after/`，或 `vim.api` / `vim.fn` 调用）：运行 LuaJIT（Lua 5.1 语义）。
- LÖVE 游戏（有 `main.lua`、`conf.lua`，用到 `love.*`）：LuaJIT；`conf.lua` 里的 `t.version` 是 LÖVE 版本。
- 嵌入式 / 游戏引擎脚本（OpenResty、Redis、Roblox Luau、Defold 等）：各有自己的版本和 API，看项目文档，不要套用标准 Lua 的假设。
- 独立脚本：`lua -v` 或 `luajit -v` 看本机版本；`.tool-versions`、`.luarc.json`（`runtime.version`）、CI 配置也会写。

版本差异（写代码前对照）：

- 5.1 / LuaJIT：没有整数类型、没有位运算符（LuaJIT 用内置的 `bit` 库）；`goto` 只有 LuaJIT 和 5.2+ 支持，标准 5.1 没有；`unpack` 是全局函数，`table.unpack` 在 5.2+（LuaJIT 默认没有）。
- 5.3+：整数 / 浮点分开，`//` 整除、`&` `|` `~` `<<` `>>` 位运算符；`utf8` 库。
- 5.4：`<const>` / `<close>` 变量属性，整数 for 循环溢出行为变了。
- `setfenv` / `getfenv` 只在 5.1；5.2+ 用 `load` 的 env 参数。
- `#` 对有空洞的表结果不确定，数组里不要放 `nil`；要保存空位用 `false` 或 `table.pack` 的 `n`。

## 工具链：看项目已有的，不擅自换

| 看到的文件 | 工具 |
| --- | --- |
| `*.rockspec`、`lua_modules/`、`.luarocks/` | luarocks 管依赖和打包 |
| `.busted`、`spec/*_spec.lua` | busted 测试 |
| `.luacheckrc` | luacheck 静态检查 |
| `stylua.toml`、`.stylua.toml` | StyLua 格式化 |
| `.luarc.json`、`.emmyrc.json` | lua-language-server 配置 |
| `Makefile`、`justfile`、`.github/workflows` | 项目约定的命令，优先照它 |

沿用现有的测试框架和风格；不要新增依赖、不要把 busted 换成别的、不要引入新的格式化工具。

## 改完怎么验证（按顺序，只跑项目配置了的）

```
luacheck .                      # 有 .luacheckrc 时；全局变量误写、未使用变量
stylua --check .                # 有 stylua.toml 时；格式不对只报告，不自动改
busted                          # 有 .busted 或 spec/ 时；单个文件 busted spec/foo_spec.lua
luarocks make                   # 有 rockspec 时：在本地装当前包；不是每次改动都要跑
```

- 没有测试框架的小脚本：直接 `lua script.lua`（或 `luajit`）跑一遍并看输出，不要为此装 busted。
- Neovim 插件：测试通常用 `plenary.nvim` 或 `mini.test`，命令看项目的 Makefile / CI，一般是 `nvim --headless -c "PlenaryBustedDirectory tests/"` 这一类；不确定就先读配置，别猜。
- 格式化前先 `stylua --check`；要真正改格式时只改自己动过的文件，免得产生整库 diff。

## 常见坑

- **忘写 `local`**：变量变成全局，luacheck 会报；模块里函数和变量默认都写 `local`，导出放进返回的表。
- **`.` 和 `:` 混用**：`obj:method()` 等于 `obj.method(obj)`，定义和调用要一致。
- **`require` 路径**：用 `.` 分隔（`require("a.b")` 对应 `a/b.lua` 或 `a/b/init.lua`），搜索路径在 `package.path`；模块只加载一次，改完要在 `package.loaded` 里清掉才会重新加载（Neovim 热重载常见）。
- **`pairs` 顺序不固定**：需要稳定顺序时先收集键再 `table.sort`。
- **字符串是字节序列**：`#"中"` 是 3；处理 Unicode 用 `utf8` 库（5.3+）或 `vim.str_utfindex` 等宿主提供的函数。
- **`nil` 与 `false`**：`x = x or default` 会把显式的 `false` 覆盖掉；需要区分时写 `if x == nil`。
- **错误处理**：可能失败的调用用 `pcall` / `xpcall(f, debug.traceback)`；抛错用 `error(msg, 2)` 指向调用者；返回 `nil, err` 是标准库的失败约定，沿用。
- **LÖVE**：绘图只能在 `love.draw` 里；`love.update(dt)` 里的移动要乘 `dt`；资源路径相对游戏根目录，不是当前工作目录。
- **Neovim**：别在模块加载时执行重活，放进 `setup()`；`vim.keymap.set` 要带 `desc`；用 `vim.schedule` 回到主循环再调 API。

## 工作方式

1. 先读相关模块和已有 spec，照现有风格写（缩进、引号、模块返回表的写法）。
2. 修 bug 先写能复现的 spec（项目有 busted 时），再改代码。
3. 报告时说清跑了哪些命令；没法在真实运行环境（Neovim、LÖVE、游戏引擎）里验证的部分明说。
