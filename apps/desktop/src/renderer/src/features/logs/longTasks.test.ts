// 界面卡住写进日志的内容（docs/ui/logging.md §4.9）
import { describe, expect, it } from 'vitest'
import { longTaskFields } from './longTasks'

describe('界面卡住', () => {
  it('带上离回到前台、拿到焦点多久，页面元素数和 JS 内存', () => {
    expect(
      longTaskFields(
        { startTime: 10_250.6, duration: 8_400.2 },
        { visible: 10_000, focus: 10_200 },
        {
          hidden: false,
          elements: 48_000,
          heap: { usedJSHeapSize: 3_500 * 1048576, jsHeapSizeLimit: 4_096 * 1048576 },
        },
      ),
    ).toEqual({
      durationMs: 8400,
      afterVisibleMs: 251,
      afterFocusMs: 51,
      hidden: false,
      elements: 48_000,
      heapMb: 3500,
      heapLimitMb: 4096,
    })
  })

  it('没切换过窗口、焦点事件排在卡住之后才处理、拿不到内存时不带这几项', () => {
    expect(longTaskFields({ startTime: 5, duration: 2_000 }, {}, { hidden: true, elements: 10 })).toEqual({
      durationMs: 2000,
      hidden: true,
      elements: 10,
    })
    expect(longTaskFields({ startTime: 5, duration: 2_000 }, { focus: 2_006 }, { hidden: true, elements: 10 })).toEqual(
      {
        durationMs: 2000,
        hidden: true,
        elements: 10,
      },
    )
  })
})
