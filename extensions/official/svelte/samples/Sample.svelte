<script lang="ts" module>
	// 模块级：所有实例共享
	export const MAX_ITEMS = 50;

	export interface Todo {
		id: number;
		title: string;
		done: boolean;
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';
	import Badge from './Badge.svelte';

	let {
		title = '待办',
		initial = [],
		header
	}: { title?: string; initial?: Todo[]; header?: Snippet<[number]> } = $props();

	let todos = $state<Todo[]>(initial);
	let draft = $state('');
	let filter = $state<'all' | 'open' | 'done'>('all');

	let remaining = $derived(todos.filter((t) => !t.done).length);
	let visible = $derived.by(() => {
		if (filter === 'open') return todos.filter((t) => !t.done);
		if (filter === 'done') return todos.filter((t) => t.done);
		return todos;
	});

	$effect(() => {
		document.title = `${title}（${remaining}）`;
		return () => {
			document.title = '';
		};
	});

	onMount(async () => {
		const res = await fetch('/api/todos?limit=' + MAX_ITEMS);
		if (res.ok) todos = await res.json();
	});

	function add(event: SubmitEvent) {
		event.preventDefault();
		const text = draft.trim();
		if (!text) return;
		todos.push({ id: Date.now(), title: text, done: false });
		draft = '';
	}
</script>

<svelte:head>
	<title>{title}</title>
</svelte:head>

<section class="todos" class:empty={todos.length === 0}>
	{@render header?.(remaining)}
	<h2>{title} <Badge count={remaining} /></h2>

	<form onsubmit={add}>
		<input bind:value={draft} placeholder="新增事项" />
		<button type="submit" disabled={!draft.trim()}>添加</button>
	</form>

	{#each ['all', 'open', 'done'] as name (name)}
		<label>
			<input type="radio" bind:group={filter} value={name} />
			{name}
		</label>
	{/each}

	{#if visible.length === 0}
		<p>没有内容</p>
	{:else}
		<ul>
			{#each visible as todo (todo.id)}
				{@const label = todo.done ? '已完成' : '进行中'}
				<li class:done={todo.done}>
					<input type="checkbox" bind:checked={todo.done} />
					<span title={label}>{todo.title}</span>
				</li>
			{/each}
		</ul>
	{/if}

	{#await Promise.resolve(remaining)}
		<p>统计中…</p>
	{:then n}
		<p>还剩 {n} 项</p>
	{:catch error}
		<p>{error.message}</p>
	{/await}
</section>

<style lang="css">
	.todos {
		max-width: 32rem;
		margin: 0 auto;
		color: #333;
	}
	.todos.empty {
		opacity: 0.6;
	}
	li.done span {
		text-decoration: line-through;
	}
</style>
