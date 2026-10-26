请把下面这段 {{language}} 代码（来自 {{file}}）从 Svelte 4 写法迁移到 Svelte 5 的 runes 写法，行为必须保持不变。

要求：
1. 先确认项目已经安装 Svelte 5（看 package.json 里 svelte 的版本）；如果还是 Svelte 4，不要改，直接告诉我。
2. 按对应关系改：export let 改为 $props()，顶层响应式变量改为 $state，$: 派生改为 $derived，$: 副作用改为 $effect，on:click 改为 onclick，createEventDispatcher 改为回调属性，slot 改为 children / snippet，需要双向绑定的属性用 $bindable。
3. 同一个组件里不要新老写法混用；用 $derived 能解决的不要写成 $effect。
4. 不改组件对外的名字和使用方式，如果使用方也需要同步修改，列出需要改的文件和位置。
5. 逐条说明改了什么，改完用项目自己的命令跑 svelte-check 和相关测试。

代码：

```svelte
{{selection}}
```
