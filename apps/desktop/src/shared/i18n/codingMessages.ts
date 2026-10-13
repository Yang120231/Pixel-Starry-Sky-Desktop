import { codingShellMessages } from './codingShellMessages'
import { codingFilesMessages } from './codingFilesMessages'
import { codingNavMessages } from './codingNavMessages'
import { codingTopMessages } from './codingTopMessages'
import { codingEditorMessages } from './codingEditorMessages'
import { codingReviewMessages } from './codingReviewMessages'
import { codingBottomMessages } from './codingBottomMessages'
import { codingRightMessages } from './codingRightMessages'
import { codingStatusMessages } from './codingStatusMessages'

/** 代码模式各模块的字典汇总（docs/ui/coding-mode-impl.md D5） */
export const codingMessages = {
  ...codingShellMessages,
  ...codingFilesMessages,
  ...codingNavMessages,
  ...codingTopMessages,
  ...codingEditorMessages,
  ...codingReviewMessages,
  ...codingBottomMessages,
  ...codingRightMessages,
  ...codingStatusMessages,
}

/** 逐字典去重检查用（regression.test.ts） */
export const codingDictionaries = {
  codingShellMessages,
  codingFilesMessages,
  codingNavMessages,
  codingTopMessages,
  codingEditorMessages,
  codingReviewMessages,
  codingBottomMessages,
  codingRightMessages,
  codingStatusMessages,
}
