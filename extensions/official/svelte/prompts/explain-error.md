下面是 {{project}} 项目里 Svelte / SvelteKit 的一段报错或警告（编译、svelte-check、运行时或水合不一致），请帮我定位原因。

要求：
1. 先指出真正的根因，并对应到项目里具体的文件和行号；打开相关代码确认，不要只凭报错文字猜测。
2. 先判断项目是 Svelte 4 还是 Svelte 5，以及是不是 SvelteKit（看 package.json 和 svelte.config.js），因为同一个报错在两个版本里原因可能不同（例如 runes 与旧写法混用）。
3. 说明触发条件，再给最小的修复方案；服务端与浏览器渲染不一致的问题，说明哪个值在两边不同。
4. 如果涉及 ./$types 找不到，先试 svelte-kit sync；不要擅自升级依赖或更换适配器。

报错内容：

```
{{selection}}
```
