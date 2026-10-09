// 入口：演示模式先装入 mock/ 的演示数据，再加载界面（docs/restructure.md §9.3）。
// 两步都是动态导入：演示数据单独打包，默认模式不加载；界面模块在装入之后才求值，模块顶层读到的就是演示数据。
import { installDemo, isDemo } from './data/demo'

async function boot(): Promise<void> {
  if (isDemo) installDemo((await import('./mock')).demoSource)
  await import('./app/start')
}

void boot()
