// 宿主错误代码的文案（docs/ui/files-search-terminal-pins.md §1）：key 为 errors.<code>，
// 主进程 / 引擎用 codedError(code, params) 抛出，界面 translateMessage 按代码查这里。
export const errorMessages = {
  'errors.files.relativePath': { zh: '请使用项目内的相对路径', en: 'Use a path inside the project' },
  'errors.files.outsideProject': { zh: '文件路径超出项目', en: 'The path is outside the project' },
  'errors.files.notFound': { zh: '文件或目录已不存在', en: 'The file or folder no longer exists' },
  'errors.files.changedOutside': {
    zh: '文件已被其他程序修改，请重新加载后再保存；当前草稿仍保留',
    en: 'The file was changed by another program. Reload before saving; your draft is kept',
  },
  'errors.files.exists': {
    zh: '已经有同名的文件或文件夹：{name}',
    en: 'A file or folder named {name} already exists',
  },
  'errors.files.invalidName': {
    zh: '名称不能为空，也不能包含 / \\ : * ? " < > |',
    en: 'Names can’t be empty or contain / \\ : * ? " < > |',
  },
  'errors.files.parentMissing': { zh: '上级文件夹不存在', en: 'The parent folder doesn’t exist' },
  'errors.files.projectRoot': { zh: '不能修改项目根目录本身', en: 'The project folder itself can’t be changed' },
  'errors.files.trashFailed': { zh: '没能移到回收站：{reason}', en: 'Couldn’t move to the trash: {reason}' },
  'errors.files.queryInvalid': { zh: '搜索内容为空或太长', en: 'The search text is empty or too long' },
  'errors.terminal.scriptNotFound': { zh: '找不到脚本：{name}', en: 'Script not found: {name}' },
  'errors.terminal.commandInvalid': { zh: '要运行的命令不正确', en: 'The command to run is invalid' },
  'errors.tasks.notFound': { zh: '任务已不存在', en: 'The task no longer exists' },
} as const
