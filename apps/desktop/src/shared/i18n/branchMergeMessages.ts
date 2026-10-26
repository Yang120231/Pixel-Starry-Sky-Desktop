// 开分支 / 合并回主会话（docs/ui/branch-merge.md）
export const branchMergeMessages = {
  // 称呼
  'branch.up.main': { zh: '主会话', en: 'main session' },
  'branch.up.parent': { zh: '上级会话', en: 'parent session' },
  'branch.up.origin': { zh: '原会话', en: 'original session' },

  // 菜单（侧栏右键、分支名下拉、消息按钮）
  'branch.menu.fork': { zh: '开分支…', en: 'Branch off…' },
  'branch.menu.forkHint': { zh: '带上对话', en: 'With chat' },
  'branch.menu.forkDesc': {
    zh: '新会话带上这个会话的对话，代码可以放进副本',
    en: 'A new session with this conversation; code can go into a copy',
  },
  'branch.menu.mergeMain': { zh: '合并回主会话…', en: 'Merge back into main session…' },
  'branch.menu.mergeParent': { zh: '合并回上级会话…', en: 'Merge back into parent session…' },
  'branch.menu.remerge': { zh: '再次合并…', en: 'Merge again…' },
  'branch.menu.mergeDesc': { zh: '把代码和结论带回「{title}」', en: 'Bring code and conclusions back to “{title}”' },
  'branch.menu.files': { zh: '{n} 个文件', en: '{n} files' },
  'branch.menu.carryNotes': { zh: '带回结论', en: 'Notes only' },
  'branch.menu.busy': { zh: 'AI 回复中', en: 'AI is replying' },
  'branch.menu.copyRemoved': { zh: '副本已删除', en: 'Copy deleted' },
  'branch.menu.metaMain': { zh: '主会话', en: 'Main session' },
  'branch.menu.metaCopy': { zh: '分支 · {branch}', en: 'Branch · {branch}' },
  'branch.menu.metaShared': { zh: '分支 · 同一个目录', en: 'Branch · same folder' },
  'branch.message.fromHere': { zh: '从这里开分支…', en: 'Branch from here…' },
  'branch.message.fromHereDesc': {
    zh: '带着这条之前的对话开新会话，代码可以放进副本，满意再合并回来',
    en: 'A new session with the conversation before this message; code can go into a copy and be merged back',
  },
  'branch.message.forkOnly': { zh: '只分叉对话', en: 'Fork conversation only' },
  'branch.message.forkOnlyDesc': {
    zh: '和以前的「分叉」一样，用同一个目录',
    en: 'Same as the old “Fork”: shares the folder',
  },

  // 开分支弹窗
  'branch.dialog.title': { zh: '开分支', en: 'Branch off' },
  'branch.dialog.titleHere': { zh: '从这里开分支', en: 'Branch from here' },
  'branch.dialog.introAll': {
    zh: '新会话带着现在为止的对话，{up}保持原样。分支里试得满意，可以再合并回来。',
    en: 'The new session carries the conversation so far; the {up} stays as it is. If the branch works out, merge it back.',
  },
  'branch.dialog.introHere': {
    zh: '新会话带着这条消息之前的对话，{up}保持原样。分支里试得满意，可以再合并回来。',
    en: 'The new session carries the conversation before this message; the {up} stays as it is. If the branch works out, merge it back.',
  },
  'branch.dialog.name': { zh: '分支会话的名字', en: 'Branch session name' },
  'branch.dialog.code': { zh: '代码', en: 'Code' },
  'branch.dialog.copy': { zh: '建一个副本，在副本里改', en: 'Make a copy and work there' },
  'branch.dialog.recommended': { zh: '推荐', en: 'Recommended' },
  'branch.dialog.copyDesc': {
    zh: '独立目录 + 新 Git 分支，{up}的文件不会被动。合并时再决定要不要把改动带回来。',
    en: 'A separate folder on a new Git branch; files of the {up} are not touched. Decide at merge time whether to bring changes back.',
  },
  'branch.dialog.shared': { zh: '和{up}用同一个目录', en: 'Share the folder with the {up}' },
  'branch.dialog.sharedDesc': {
    zh: '只分开对话，代码改动直接落在 {dir}（和以前的「分叉」一样）。',
    en: 'Only the conversation is separate; code changes land in {dir} (like the old “Fork”).',
  },
  'branch.dialog.noGit': {
    zh: '工作目录不是 Git 仓库，只能用同一个目录。',
    en: 'The folder is not a Git repository, so only sharing the folder is possible.',
  },
  'branch.dialog.gitBranch': { zh: 'Git 分支', en: 'Git branch' },
  'branch.dialog.from': { zh: '从 {base} 新建', en: 'New from {base}' },
  'branch.dialog.fromHead': { zh: '从当前提交新建', en: 'New from current commit' },
  'branch.dialog.copyName': { zh: '副本名', en: 'Copy name' },
  'branch.dialog.copyDir': { zh: '副本目录：{path}', en: 'Copy folder: {path}' },
  'branch.dialog.carry': { zh: '带上没提交的改动（{n} 个文件）', en: 'Bring uncommitted changes ({n} files)' },
  'branch.dialog.carryHint': {
    zh: '副本里的代码和现在的目录一模一样；不勾就从最近一次提交开始。',
    en: 'The copy matches the folder exactly; unchecked, it starts from the last commit.',
  },
  'branch.dialog.context': {
    zh: '会带上 {n} 条消息（约 {k}K 上下文）。',
    en: 'Carries {n} messages (about {k}K context).',
  },
  'branch.dialog.contextDraft': {
    zh: '「{text}」放进新会话的输入框，你可以先改再发。',
    en: '“{text}” goes into the new session’s input box; edit it before sending if you like.',
  },
  'branch.dialog.contextEmpty': { zh: '新会话的输入框是空的。', en: 'The new session’s input box is empty.' },
  'branch.dialog.submit': { zh: '开分支', en: 'Branch off' },
  'branch.dialog.creatingCopy': { zh: '正在建副本…', en: 'Creating copy…' },
  'branch.dialog.forking': { zh: '正在分叉…', en: 'Forking…' },
  'branch.dialog.cancel': { zh: '取消', en: 'Cancel' },
  'branch.dialog.loading': { zh: '正在读取…', en: 'Loading…' },
  'branch.dialog.errBranchFormat': {
    zh: '分支名只能用英文字母、数字和 . _ - /',
    en: 'Branch names may only use letters, digits and . _ - /',
  },
  'branch.dialog.errBranchTaken': {
    zh: '已经有 {name} 了，换一个名字',
    en: '{name} already exists; pick another name',
  },
  'branch.dialog.errCopyName': {
    zh: '副本名不能有 \\ / : * ? " < > | 这些字符',
    en: 'Copy names cannot contain \\ / : * ? " < > |',
  },
  'branch.dialog.errCopyTaken': { zh: '已经有叫 {name} 的副本了', en: 'A copy named {name} already exists' },
  'branch.created': {
    zh: '已开分支「{title}」，代码在副本 {branch}',
    en: 'Branched “{title}”; code is in copy {branch}',
  },
  'branch.createdShared': { zh: '已开分支「{title}」', en: 'Branched “{title}”' },

  // 分支会话里
  'branch.banner.copy': {
    zh: '分支会话 · 从「{title}」开出 · 代码在副本 {branch}，不影响{up}的目录',
    en: 'Branch session · from “{title}” · code is in copy {branch}, the {up}’s folder is untouched',
  },
  'branch.banner.shared': {
    zh: '分支会话 · 从「{title}」开出 · 和它用同一个目录',
    en: 'Branch session · from “{title}” · shares its folder',
  },
  'branch.banner.removed': {
    zh: '已合并到「{title}」 · 副本和分支已删除，这个会话只能回看',
    en: 'Merged into “{title}” · copy and branch deleted; this session is read-only',
  },
  'branch.banner.merged': { zh: '合并过一次', en: 'Merged once' },
  'branch.banner.parentGone': { zh: '上级会话已经不在了', en: 'The parent session no longer exists' },
  'branch.banner.mergeMain': { zh: '合并回主会话', en: 'Merge into main session' },
  'branch.banner.mergeParent': { zh: '合并回上级会话', en: 'Merge into parent session' },
  'branch.banner.remerge': { zh: '再次合并', en: 'Merge again' },
  'branch.divider': { zh: '分支从这里开始', en: 'Branch starts here' },
  'branch.readonly': {
    zh: '副本已删除，这个分支会话只能回看',
    en: 'The copy was deleted; this branch session is read-only',
  },

  // 合并面板
  'merge.intro': {
    zh: '把分支「{branch}」的代码和结论带回「{title}」。分支会话会保留，随时能回看。',
    en: 'Bring the code and conclusions of “{branch}” back to “{title}”. The branch session is kept for later.',
  },
  'merge.loading': { zh: '正在检查改动…', en: 'Checking changes…' },
  'merge.code': { zh: '代码', en: 'Code' },
  'merge.codeMeta': { zh: '{from} → {to} · {n} 个文件', en: '{from} → {to} · {n} files' },
  'merge.codeShared': {
    zh: '和「{title}」用同一个目录，改动已经在那里，不用合并',
    en: 'Shares the folder with “{title}”; changes are already there',
  },
  'merge.codeNone': { zh: '分支里还没改代码', en: 'No code changes in the branch' },
  'merge.copyGone': { zh: '副本已经不在了，代码没法合并', en: 'The copy is gone; code cannot be merged' },
  'merge.codeUnknown': {
    zh: '找不到「{title}」的 Git 仓库，算不出副本里的改动',
    en: 'Cannot find the Git repository of “{title}”, so changes in the copy cannot be worked out',
  },
  'merge.codeUnknownKeep': {
    zh: '代码这次没法合并，副本保留，免得改动丢了；可以只合并对话。',
    en: 'Code cannot be merged this time and the copy is kept so nothing is lost; you can merge only the conversation.',
  },
  'merge.commit': { zh: '压成一个提交', en: 'One commit' },
  'merge.apply': { zh: '只放进工作区', en: 'Working tree only' },
  'merge.commitMsg': { zh: '提交信息', en: 'Commit message' },
  'merge.applyHint': {
    zh: '改动写进「{title}」的目录，不提交；之后在 Git 面板里看、提交。',
    en: 'Changes are written into “{title}”’s folder without committing; review and commit in the Git panel.',
  },
  'merge.commitBlocked': {
    zh: '这些文件在那边有没提交的改动，不能直接提交：{files}',
    en: 'These files have uncommitted changes there, so they cannot be committed directly: {files}',
  },
  'merge.removeCopy': { zh: '合并后删除副本和分支', en: 'Delete the copy and branch after merging' },
  'merge.keepCopy': {
    zh: '代码不合并时保留副本，免得改动丢了。',
    en: 'The copy is kept when code is not merged, so nothing is lost.',
  },
  'merge.auto': { zh: '自动合并', en: 'Auto-merged' },
  'merge.newFile': { zh: '新文件', en: 'New' },
  'merge.deletedFile': { zh: '删除', en: 'Deleted' },
  'merge.conflictTag': { zh: '合不上', en: 'Conflict' },
  'merge.reason.conflict': { zh: '两边改了同样的地方', en: 'both sides changed the same lines' },
  'merge.reason.binary': { zh: '二进制文件两边都改了', en: 'binary file changed on both sides' },
  'merge.reason.deleted': { zh: '分支里删了，那边又改过', en: 'deleted in the branch, changed there' },
  'merge.reason.removedThere': { zh: '那边删了，分支里改过', en: 'deleted there, changed in the branch' },
  'merge.reason.addedBoth': { zh: '两边都新建了这个文件', en: 'created on both sides' },
  'merge.reason.submodule': { zh: '子模块的改动没法合并', en: 'submodule changes cannot be merged' },
  'merge.conflicts': {
    zh: '{n} 个文件合不上：「{title}」那边也改了。先在那边提交或撤销这些文件，或者在副本里手动处理；这次可以只合并对话。',
    en: '{n} files conflict with changes in “{title}”. Commit or discard them there, or resolve them in the copy; you can merge only the conversation this time.',
  },
  'merge.chat': { zh: '对话', en: 'Conversation' },
  'merge.chatMeta': {
    zh: 'AI 写的摘要，带回「{title}」；合并前可以改',
    en: 'An AI summary for “{title}”; edit it before merging',
  },
  'merge.regen': { zh: '重新生成', en: 'Regenerate' },
  'merge.writing': { zh: 'AI 正在读分支里的对话，写摘要…', en: 'AI is reading the branch and writing a summary…' },
  'merge.draftNote': {
    zh: 'AI 没写成，先用整理好的草稿，可以直接改。',
    en: 'The AI summary failed; here is a draft you can edit.',
  },
  'merge.summaryNote': {
    zh: '合并后作为一条「分支合并」记录放进{up}，下一次发消息时一起带给 AI。以「·」开头的行显示成列表。',
    en: 'After merging it appears as a “Branch merged” card in the {up} and goes to the AI with the next message. Lines starting with “·” become a list.',
  },
  'merge.submit': { zh: '合并', en: 'Merge' },
  'merge.submitCode': { zh: '只合并代码', en: 'Merge code only' },
  'merge.submitChat': { zh: '只合并对话', en: 'Merge conversation only' },
  'merge.merging': { zh: '正在合并…', en: 'Merging…' },
  'merge.runningSelf': {
    zh: '分支会话正在运行，等它停下再合并',
    en: 'The branch session is running; wait for it to stop',
  },
  'merge.runningParent': {
    zh: '上级会话正在运行，等它停下再合并',
    en: 'The parent session is running; wait for it to stop',
  },
  'merge.changedDuring': {
    zh: '合并期间上级目录里要写的文件又改过了，重新合并一次',
    en: 'Files to be written in the parent folder changed during the merge; merge again',
  },
  'merge.copyChanged': {
    zh: '分支在合并期间又有改动，副本先留着',
    en: 'The branch changed during the merge, so the copy was kept',
  },
  'merge.done': { zh: '已合并到「{title}」', en: 'Merged into “{title}”' },
  'merge.doneRemoved': { zh: '已合并到「{title}」，副本已删除', en: 'Merged into “{title}”; copy deleted' },
  'merge.commitFailed': {
    zh: '改动已放进「{title}」的目录，但提交没成功：{error}',
    en: 'Changes are in “{title}”’s folder, but the commit failed: {error}',
  },
  'merge.removeFailed': { zh: '合并好了，但副本没删掉：{error}', en: 'Merged, but the copy was not deleted: {error}' },
  // 主进程报的错（按原文匹配翻译）
  'merge.error.codeUnknown': {
    zh: '找不到上级目录的 Git 仓库，算不出副本里的改动，代码没法合并',
    en: 'Cannot find the Git repository of the parent folder, so changes in the copy cannot be worked out and code cannot be merged',
  },
  'merge.error.symlinkPath': {
    zh: '路径里有符号链接，不能写：{path}',
    en: 'The path goes through a symbolic link, so it cannot be written: {path}',
  },
  'merge.error.lfs': {
    zh: '没能把 Git LFS 指针换成文件内容（可能没装 git-lfs），不能合并：{path}',
    en: 'Could not turn the Git LFS pointer into the file content (git-lfs may not be installed), so it cannot be merged: {path}',
  },
  'merge.error.partial': {
    zh: '写到一半出错：{error}。已经写进去的文件：{files}',
    en: 'Writing stopped partway: {error}. Files already written: {files}',
  },
  'merge.error.oldGit': {
    zh: 'git 版本低于 2.26，要提交的文件太多，没法一次提交；请升级 git，或者选「只放进工作区」',
    en: 'Git is older than 2.26 and there are too many files to commit at once; upgrade Git or choose “Working tree only”',
  },

  // 合并卡片和输入框上方的提示
  'merge.card.title': { zh: '合并了分支「{title}」', en: 'Merged branch “{title}”' },
  'merge.card.applied': { zh: '放进了工作区，没提交', en: 'In the working tree, not committed' },
  'merge.card.none': { zh: '没有代码要合并', en: 'No code to merge' },
  'merge.card.skipped': { zh: '代码没合并，还在副本里', en: 'Code not merged; still in the copy' },
  'merge.card.files': { zh: '{n} 个文件', en: '{n} files' },
  'merge.card.copyRemoved': { zh: '副本已删除', en: 'Copy deleted' },
  'merge.card.copyKept': { zh: '副本保留：{branch}', en: 'Copy kept: {branch}' },
  'merge.card.open': { zh: '打开分支会话', en: 'Open branch session' },
  'merge.card.showFiles': { zh: '查看改动', en: 'Show changes' },
  'merge.card.hideFiles': { zh: '收起改动', en: 'Hide changes' },
  'merge.card.noSummary': { zh: '只合并了代码，没有带回摘要。', en: 'Only code was merged; no summary.' },
  'merge.pending': {
    zh: '下一条消息会带上「{title}」的合并摘要',
    en: 'The next message will include the merge summary of “{title}”',
  },
  'merge.pendingDrop': { zh: '这次不带', en: 'Don’t include' },

  // 侧栏
  'branch.tag.copy': { zh: '分支', en: 'Branch' },
  'branch.tag.shared': { zh: '同目录', en: 'Shared' },
  'branch.tag.merged': { zh: '已合并', en: 'Merged' },
} as const
