请帮我看懂下面这段 Lua 报错或堆栈，找出根因：

```
{{selection}}
```

要求：
1. 先说这条报错的意思（比如 `attempt to index a nil value`、`attempt to call a nil value` 是哪个变量、哪个字段为 nil）。
2. 到代码里（项目 {{project}}）定位报错行，顺着调用链找 nil 的来源，不要只看最后一行。
3. 先确认运行时（Lua 5.1 / 5.4 / LuaJIT / Neovim / LÖVE）再给结论，因为不同版本的标准库和语法不一样。
4. 给出最小的修复方案并说明原因；需要我先确认的假设单独列出，不要硬猜。
