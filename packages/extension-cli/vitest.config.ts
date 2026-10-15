import { defineConfig } from 'vitest/config'

// 脚手架阶段还没有测试文件；各 WP 加了测试后这个选项无害
export default defineConfig({ test: { passWithNoTests: true } })
