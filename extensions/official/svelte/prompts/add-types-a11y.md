请检查并改进下面这段 {{language}} 代码（来自 {{file}}，项目 {{project}}）的类型和无障碍问题。

要求：
1. 类型：script 用 lang="ts" 时，给属性、事件回调、状态补上准确的类型，不用 any；SvelteKit 的页面和 load 用 ./$types 里生成的类型（PageData、PageLoad 等）。
2. 无障碍：按钮、图片、表单控件要有可访问的名称（label、alt、aria-label），可点击的元素用 button 或 a 而不是带点击事件的 div，补上必要的键盘支持。
3. 先判断项目是 Svelte 4 还是 Svelte 5，保持原有写法，不要顺手迁移；不改组件对外的行为和名字。
4. 逐条说明改了什么，改完用项目自己的命令跑 svelte-check，并告诉我结果。

代码：

```svelte
{{selection}}
```
