// 模型通道（docs/ui/model-channels.md）：四条通道、谁来执行、授权弹窗、设置页
export const modelChannelMessages = {
  'modelChannels.title': { zh: '模型通道', en: 'Model channels' },
  'modelChannels.channel.platform': { zh: '像素星空账号', en: 'PixelSky account' },
  'modelChannels.channel.claude': { zh: 'Claude 授权', en: 'Claude sign-in' },
  'modelChannels.channel.chatgpt': { zh: 'ChatGPT 授权', en: 'ChatGPT sign-in' },
  'modelChannels.channel.custom': { zh: '自定义接口', en: 'Custom API' },
  'modelChannels.short.platform': { zh: '像素星空', en: 'PixelSky' },
  'modelChannels.short.claude': { zh: 'Claude 授权', en: 'Claude' },
  'modelChannels.short.chatgpt': { zh: 'ChatGPT 授权', en: 'ChatGPT' },
  'modelChannels.short.custom': { zh: '自定义接口', en: 'Custom API' },

  // 通道状态（菜单分组、设置卡片）
  'modelChannels.state.signin': { zh: '登录像素星空后可用', en: 'Sign in to PixelSky to use it' },
  'modelChannels.state.loading': { zh: '读取中…', en: 'Loading…' },
  'modelChannels.state.noRoute': { zh: '没有能用的线路', en: 'No routes available' },
  'modelChannels.state.auth': { zh: '还没授权', en: 'Not signed in' },
  'modelChannels.state.missing': { zh: '没装 {p0}', en: '{p0} is not installed' },
  'modelChannels.state.outdated': { zh: '{p0} 版本太低', en: '{p0} is out of date' },
  'modelChannels.state.error': { zh: '{p0} 暂时不可用', en: '{p0} is unavailable' },
  'modelChannels.state.empty': { zh: '还没加接口', en: 'No endpoints yet' },
  'modelChannels.action.signIn': { zh: '登录', en: 'Sign in' },
  'modelChannels.action.auth': { zh: '去授权', en: 'Sign in' },
  'modelChannels.action.install': { zh: '去安装', en: 'Install' },
  'modelChannels.action.update': { zh: '去更新', en: 'Update' },
  'modelChannels.action.view': { zh: '查看', en: 'Details' },
  'modelChannels.action.addEndpoint': { zh: '添加接口', en: 'Add endpoint' },
  'modelChannels.action.retry': { zh: '重试', en: 'Retry' },

  // 谁来执行（§2.5）
  'modelChannels.executor.title': { zh: '谁来执行', en: 'Run with' },
  'modelChannels.executor.pixel': { zh: '像素星空 agent', en: 'PixelSky agent' },
  'modelChannels.executor.recommended': { zh: '推荐', en: 'Recommended' },
  'modelChannels.executor.desc.claude': {
    zh: 'Anthropic 官方的工具，对 Claude 模型最熟',
    en: "Anthropic's official tool, best with Claude models",
  },
  'modelChannels.executor.desc.codex': {
    zh: 'OpenAI 官方的工具，对 GPT 模型最熟',
    en: "OpenAI's official tool, best with GPT models",
  },
  'modelChannels.executor.desc.pixel': {
    zh: '我们自带的，启动快，不用另外装程序',
    en: 'Built in, starts fast, nothing else to install',
  },
  'modelChannels.executor.notInstalled': { zh: '没装', en: 'Not installed' },
  'modelChannels.executor.unavailable': { zh: '暂时不可用', en: 'Unavailable' },
  'modelChannels.executor.lockedNote': {
    zh: '开始对话后就不能换了',
    en: "Can't be changed once the conversation starts",
  },
  'modelChannels.executor.switch': { zh: '换一个执行者', en: 'Change who runs it' },
  'modelChannels.executor.fallbackMissing': {
    zh: '{p0} 没装，改由 {p1} 执行',
    en: "{p0} isn't installed, {p1} runs it",
  },
  'modelChannels.executor.fallbackUnavailable': {
    zh: '{p0} 不可用，改由 {p1} 执行',
    en: '{p0} is unavailable, {p1} runs it',
  },
  'modelChannels.row.locked': { zh: '{p0} 执行，新开任务再选', en: 'Runs with {p0}; pick it in a new task' },
  'modelChannels.row.noExecutor': { zh: '{p0} 不可用', en: '{p0} is unavailable' },
  'modelChannels.engineLocked': {
    zh: '这个对话用的是 {p0}，新开任务再换',
    en: 'This conversation runs with {p0}; switch in a new task',
  },
  'modelChannels.continueLast': { zh: '接着上次', en: 'Same as last time' },
  'modelChannels.continueLastTitle': {
    zh: '沿用上一个对话选的模型；设置 › 模型通道里可以改成固定一个',
    en: 'Uses the model from your last conversation; you can pin one in Settings › Model channels',
  },
  'modelChannels.menu.settings': { zh: '通道设置', en: 'Channel settings' },
  'modelChannels.lockedNote': {
    zh: '这个对话用 {p0} 执行，只能换它能跑的模型',
    en: 'This conversation runs with {p0}; only models it can run are available',
  },

  // 授权弹窗（§3）
  'modelChannels.auth.title': { zh: '在浏览器里授权 {p0}', en: 'Sign in to {p0} in your browser' },
  'modelChannels.auth.deviceTitle': { zh: '用设备码授权 {p0}', en: 'Sign in to {p0} with a device code' },
  'modelChannels.auth.starting': { zh: '正在启动 {p0} 的登录…', en: 'Starting {p0} sign-in…' },
  'modelChannels.auth.browserHint': {
    zh: '已经在默认浏览器打开登录页，登录并点「授权」后这里自动完成。',
    en: 'The sign-in page is open in your default browser. Sign in and approve; this finishes by itself.',
  },
  'modelChannels.auth.waiting': { zh: '等你在浏览器里完成…', en: 'Waiting for the browser…' },
  'modelChannels.auth.copyLink': { zh: '复制链接', en: 'Copy link' },
  'modelChannels.auth.reopen': { zh: '重新打开', en: 'Open again' },
  'modelChannels.auth.codeLabel': {
    zh: '页面显示了授权码？粘贴到这里',
    en: 'Did the page show a code? Paste it here',
  },
  'modelChannels.auth.codePlaceholder': { zh: '授权码', en: 'Code' },
  'modelChannels.auth.submitCode': { zh: '提交', en: 'Submit' },
  'modelChannels.auth.noBrowser': { zh: '浏览器打不开？（远程机器、没有浏览器）', en: 'No browser here?' },
  'modelChannels.auth.useDevice': { zh: '改用设备码', en: 'Use a device code' },
  'modelChannels.auth.backToBrowser': { zh: '改回浏览器登录', en: 'Use the browser instead' },
  'modelChannels.auth.deviceStep': {
    zh: '在任意设备上打开下面的网址，输入这个一次性码（15 分钟内有效）：',
    en: 'Open this page on any device and enter the one-time code (valid for 15 minutes):',
  },
  'modelChannels.auth.waitingCode': { zh: '正在取一次性码…', en: 'Getting a code…' },
  'modelChannels.auth.openPage': { zh: '打开网页', en: 'Open page' },
  'modelChannels.auth.copyCode': { zh: '复制码', en: 'Copy code' },
  'modelChannels.auth.verify': { zh: '正在确认授权…', en: 'Checking the sign-in…' },
  'modelChannels.auth.done': { zh: '已授权', en: 'Signed in' },
  'modelChannels.auth.failed': { zh: '没有授权成功', en: "Sign-in didn't finish" },
  'modelChannels.auth.cancelled': { zh: '已取消授权', en: 'Sign-in cancelled' },
  'modelChannels.auth.terminalHint': {
    zh: '也可以在内置终端里运行 {p0} 自己登录。',
    en: 'You can also run {p0} in the built-in terminal.',
  },
  'modelChannels.auth.terminal': { zh: '在终端里登录', en: 'Sign in from terminal' },
  'modelChannels.auth.terminalTitle': { zh: '{p0} 登录', en: '{p0} sign-in' },
  'modelChannels.auth.needInstall': { zh: '先安装 {p0}，再回来授权。', en: 'Install {p0} first, then sign in.' },
  'modelChannels.auth.cancel': { zh: '取消', en: 'Cancel' },
  'modelChannels.auth.close': { zh: '关闭', en: 'Close' },
  'modelChannels.auth.finish': { zh: '完成', en: 'Done' },
  // 设置 › 模型通道（§2.1、§2.6）
  'modelChannels.intro': {
    zh: '选模型时先选走哪条通道：用像素星空的额度、用自己的 Claude / ChatGPT 订阅，或者自己填接口。',
    en: 'Each model goes through one channel: PixelSky credits, your own Claude / ChatGPT subscription, or your own API.',
  },
  'modelChannels.platform.desc': { zh: '登录后按用量扣余额', en: 'Sign in and pay as you go from your balance' },
  'modelChannels.platform.engines': { zh: 'Claude Code、Codex 都能用', en: 'Works with Claude Code and Codex' },
  'modelChannels.platform.signIn': { zh: '登录像素星空', en: 'Sign in to PixelSky' },
  'modelChannels.platform.account': { zh: '账号与充值', en: 'Account & top-up' },
  'modelChannels.platform.signOut': { zh: '退出', en: 'Sign out' },
  'modelChannels.claude.desc': {
    zh: '用自己的 Claude Pro / Max 订阅，交给 Claude Code 跑',
    en: 'Use your Claude Pro / Max plan with Claude Code',
  },
  'modelChannels.chatgpt.desc': {
    zh: '用自己的 ChatGPT Plus / Pro 账号，交给 Codex 跑',
    en: 'Use your ChatGPT Plus / Pro account with Codex',
  },
  'modelChannels.claude.signIn': { zh: '用 Claude 授权', en: 'Sign in with Claude' },
  'modelChannels.chatgpt.signIn': { zh: '用 ChatGPT 授权', en: 'Sign in with ChatGPT' },
  'modelChannels.custom.desc': {
    zh: '自己填地址和 Key：中转站、官方 API Key、DeepSeek、本地 Ollama……',
    en: 'Your own URL and key: relays, official API keys, DeepSeek, local Ollama…',
  },
  'modelChannels.authCard.switch': { zh: '切换账号', en: 'Switch account' },
  'modelChannels.authCard.logout': { zh: '取消授权', en: 'Sign out' },
  'modelChannels.authCard.apiKey': { zh: '用 API Key 登录', en: 'Signed in with an API key' },
  'modelChannels.authCard.provider': {
    zh: '正在用 config.toml 里的接口「{p0}」，没有登录 ChatGPT',
    en: 'Using the “{p0}” provider from config.toml, not signed in to ChatGPT',
  },
  'modelChannels.authCard.providerHint': {
    zh: '这个接口不用授权，在这里取消不了。要改用 ChatGPT，先去掉 ~/.codex/config.toml 里的 model_provider，再回来授权',
    en: 'This provider needs no sign-in and can’t be removed here. To use ChatGPT, remove model_provider from ~/.codex/config.toml, then sign in here',
  },
  'modelChannels.authCard.remote': {
    zh: '现在选的是远程机器：那台机器上的引擎要在那台机器上登录（「机器与连接」里看）',
    en: 'A remote machine is selected: sign in to its engines on that machine (see Machines)',
  },
  'modelChannels.authCard.logoutTitle': { zh: '取消「{p0}」？', en: 'Sign out of {p0}?' },
  'modelChannels.authCard.logoutDesc': {
    zh: '{p0} 会退出登录，重新授权前这条通道用不了。',
    en: '{p0} will be signed out; this channel stops working until you sign in again.',
  },
  'modelChannels.authCard.switchTitle': { zh: '切换「{p0}」的账号？', en: 'Switch the {p0} account?' },
  'modelChannels.authCard.switchDesc': {
    zh: '先让 {p0} 退出现在的账号，再在浏览器里登录另一个。',
    en: '{p0} signs out of the current account first, then you sign in with another one in the browser.',
  },
  'modelChannels.newTask.title': { zh: '新对话用', en: 'New conversations use' },
  'modelChannels.newTask.desc': {
    zh: '新开任务时默认选哪个模型；接着上次就是沿用上一个对话选的',
    en: 'Which model a new task starts with; "same as last time" reuses your last pick',
  },
  'modelChannels.newTask.fixed': { zh: '固定为', en: 'Always' },
  'modelChannels.newTask.pick': { zh: '选一个模型', en: 'Pick a model' },
  'modelChannels.newTask.missing': {
    zh: '固定的模型现在用不了（没登录、没授权或接口删了），新任务会先用它，发送前会提示',
    en: "The pinned model isn't available right now; new tasks will warn before sending",
  },
  // 添加接口的协议卡（§2.2）
  'modelChannels.protocol.anthropic': {
    zh: 'Claude 官方、Claude 中转站 → Claude Code 执行（也可以换像素星空 agent）',
    en: 'Anthropic API and Claude relays → runs with Claude Code (or the PixelSky agent)',
  },
  'modelChannels.protocol.responses': {
    zh: 'OpenAI 官方、新一点的中转站 → Codex 执行（也可以换像素星空 agent）',
    en: 'OpenAI API and newer relays → runs with Codex (or the PixelSky agent)',
  },
  'modelChannels.protocol.chat': {
    zh: 'DeepSeek、通义、Kimi、本地 Ollama 等兼容接口 → 像素星空 agent 执行',
    en: 'DeepSeek, Qwen, Kimi, local Ollama and other compatible APIs → runs with the PixelSky agent',
  },
} as const
