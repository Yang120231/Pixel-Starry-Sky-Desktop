<!-- 示例组件：待办列表 -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

interface Todo {
  id: number
  title: string
  done: boolean
}

const props = withDefaults(
  defineProps<{
    initial?: Todo[]
    limit?: number
  }>(),
  { initial: () => [], limit: 10 },
)

const emit = defineEmits<{
  change: [count: number]
}>()

const todos = ref<Todo[]>([...props.initial])
const draft = ref('')
const filter = ref<'all' | 'open'>('all')

const visible = computed(() => (filter.value === 'open' ? todos.value.filter(t => !t.done) : todos.value))

function add() {
  const title = draft.value.trim()
  if (!title || todos.value.length >= props.limit) return
  todos.value.push({ id: Date.now(), title, done: false })
  draft.value = ''
}

watch(
  () => todos.value.length,
  n => emit('change', n),
  { immediate: true },
)

onMounted(() => {
  /* 块注释：这里可以加载数据 */
  console.log(`共 ${todos.value.length} 项，上限 ${props.limit}`)
})
</script>

<template>
  <section class="todo" :class="{ empty: !visible.length }">
    <h2>待办（{{ visible.length }}）</h2>
    <form @submit.prevent="add">
      <input v-model="draft" type="text" placeholder="新任务" maxlength="80" />
      <button type="submit" :disabled="!draft">添加</button>
    </form>
    <label v-for="mode in ['all', 'open'] as const" :key="mode">
      <input v-model="filter" type="radio" :value="mode" /> {{ mode }}
    </label>
    <ul v-if="visible.length">
      <li v-for="todo in visible" :key="todo.id" :class="{ done: todo.done }">
        <input v-model="todo.done" type="checkbox" />
        <span>{{ todo.title }}</span>
      </li>
    </ul>
    <p v-else>没有任务</p>
    <slot name="footer" :count="todos.length" />
  </section>
</template>

<style scoped lang="scss">
$gap: 8px;

.todo {
  display: flex;
  flex-direction: column;
  gap: $gap;
  color: #333;

  &.empty {
    opacity: 0.6;
  }

  .done span {
    text-decoration: line-through;
  }
}
</style>
