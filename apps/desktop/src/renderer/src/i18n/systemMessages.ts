// 宿主错误及原生窗口文案；CLI 原始输出和用户内容保持原文。
export const systemMessages = {
  "composer.attachment.closePreview": { "zh": "关闭图片预览", "en": "Close image preview" },
  "composer.attachment.loading": { "zh": "正在读取图片…", "en": "Reading images…" },
  "composer.attachment.saveError": { "zh": "图片草稿保存失败，当前图片仍保留，请重试", "en": "Could not save the image draft. Your images are preserved; please retry" },
  "composer.attachment.restoreError": { "zh": "图片草稿读取失败，请重新打开或添加图片", "en": "Could not restore image drafts. Reopen the conversation or add images again" },
  "composer.attachment.invalid": { "zh": "图片附件格式不正确", "en": "Invalid image attachment format" },
  "composer.attachment.dimensions": { "zh": "图片尺寸不正确", "en": "Invalid image dimensions" },
  "composer.attachment.data": { "zh": "图片数据不正确", "en": "Invalid image data" },
  "composer.attachment.mismatch": { "zh": "图片类型与内容不符", "en": "Image type does not match its content" },
  "composer.attachment.addImage": { "zh": "图片", "en": "Image" },
  "composer.attachment.addImageTitle": { "zh": "添加图片", "en": "Add image" },
  "composer.attachment.remove": { "zh": "移除图片", "en": "Remove image" },
  "composer.attachment.preview": { "zh": "预览图片", "en": "Preview image" },
  "composer.attachment.drop": { "zh": "松开以添加图片", "en": "Drop to add images" },
  "composer.attachment.invalidType": { "zh": "只支持 PNG、JPEG、WebP 和 GIF 图片", "en": "Only PNG, JPEG, WebP and GIF images are supported" },
  "composer.attachment.tooLarge": { "zh": "图片过大，单张不能超过 10 MiB", "en": "Image is too large. Each image must be 10 MiB or smaller" },
  "composer.attachment.totalTooLarge": { "zh": "图片总大小不能超过 20 MiB", "en": "Images cannot exceed 20 MiB in total" },
  "composer.attachment.tooMany": { "zh": "一条消息最多添加 5 张图片", "en": "You can add up to 5 images per message" },
  "composer.attachment.readError": { "zh": "图片读取失败，请重试", "en": "Could not read the image. Please try again" },
  "composer.attachment.unsupportedEngine": { "zh": "当前引擎不支持图片输入", "en": "The current engine does not support image input" },
  "composer.attachment.count": { "zh": "{p0} 张图片", "en": "{p0} images" },
  "settings.motion.off": { "zh": "关闭", "en": "Off" },
  "system.message0": {
    "zh": "版本不符",
    "en": "Version mismatch"
  },
  "system.message1": {
    "zh": "令牌缺失",
    "en": "Missing token"
  },
  "system.message2": {
    "zh": "请求超时",
    "en": "Request timed out"
  },
  "system.message3": {
    "zh": "未知错误",
    "en": "Unknown error"
  },
  "system.message4": {
    "zh": "网络错误：{p0}",
    "en": "Network error: {p0}"
  },
  "system.message5": {
    "zh": "服务暂时不可用",
    "en": "Service temporarily unavailable"
  },
  "system.message6": {
    "zh": "请求失败（HTTP {p0}{p1}）",
    "en": "Request failed (HTTP {p0}{p1})"
  },
  "system.message7": {
    "zh": "服务返回的令牌数据异常",
    "en": "Invalid token data returned by service"
  },
  "system.message8": {
    "zh": "无效的平台接口",
    "en": "Invalid platform API"
  },
  "system.message9": {
    "zh": "请先登录像素星空账号",
    "en": "Sign in to Pixel Starry Sky first"
  },
  "system.message10": {
    "zh": "账号已退出，请重新登录",
    "en": "Account signed out. Sign in again."
  },
  "system.message11": {
    "zh": "服务返回的账号数据异常",
    "en": "Invalid account data returned by service"
  },
  "system.message12": {
    "zh": "登录已过期，请重新登录",
    "en": "Sign-in expired. Sign in again."
  },
  "system.message13": {
    "zh": "登录成功",
    "en": "Signed in successfully"
  },
  "system.message14": {
    "zh": "已取消授权",
    "en": "Authorization cancelled"
  },
  "system.message15": {
    "zh": "登录失败",
    "en": "Sign-in failed"
  },
  "system.message16": {
    "zh": "已回到 Pixel Starry Sky，可以关闭此页面。",
    "en": "You have returned to Pixel Starry Sky. You can close this page."
  },
  "system.message17": {
    "zh": "没有登录任何账号。需要时可以回到 Pixel Starry Sky 重新登录。",
    "en": "No account is signed in. Return to Pixel Starry Sky to sign in when needed."
  },
  "system.message18": {
    "zh": "{p0}。请回到 Pixel Starry Sky 重试。",
    "en": "{p0}. Return to Pixel Starry Sky and try again."
  },
  "system.message19": {
    "zh": "未知原因",
    "en": "Unknown reason"
  },
  "system.message20": {
    "zh": "登录失败：服务暂时不可用",
    "en": "Sign-in failed: service temporarily unavailable"
  },
  "system.message21": {
    "zh": "登录失败：{p0}",
    "en": "Sign-in failed: {p0}"
  },
  "system.message22": {
    "zh": "登录超时，请重试",
    "en": "Sign-in timed out. Try again."
  },
  "system.message23": {
    "zh": "状态校验不通过",
    "en": "State validation failed"
  },
  "system.message24": {
    "zh": "回调缺少授权码",
    "en": "Authorization callback is missing its code"
  },
  "system.message25": {
    "zh": "登录失败：回调缺少授权码",
    "en": "Sign-in failed: missing authorization code"
  },
  "system.message26": {
    "zh": "登录失败：无法启动本地回调服务（{p0}）",
    "en": "Sign-in failed: could not start local callback service ({p0})"
  },
  "system.message27": {
    "zh": "登录失败：无法启动本地回调服务",
    "en": "Sign-in failed: could not start local callback service"
  },
  "system.message28": {
    "zh": "登录失败：无法打开浏览器（{p0}）",
    "en": "Sign-in failed: could not open browser ({p0})"
  },
  "system.message29": {
    "zh": "像素星空",
    "en": "Pixel Starry Sky"
  },
  "system.message30": {
    "zh": "打不开数据目录：{p0}",
    "en": "Could not open data directory: {p0}"
  },
  "system.message31": {
    "zh": "不允许的调用方",
    "en": "Unauthorized caller"
  },
  "system.message32": {
    "zh": "未知的链接",
    "en": "Unknown link"
  },
  "system.message33": {
    "zh": "文件行列不正确",
    "en": "Invalid file line or column"
  },
  "system.message34": {
    "zh": "编辑器设置不正确",
    "en": "Invalid editor settings"
  },
  "system.message35": {
    "zh": "编辑器不存在",
    "en": "Editor not found"
  },
  "system.message36": {
    "zh": "窗口方式不正确",
    "en": "Invalid window mode"
  },
  "system.message37": {
    "zh": "打开方式不存在",
    "en": "Opening method not found"
  },
  "system.message38": {
    "zh": "未知编辑器",
    "en": "Unknown editor"
  },
  "system.message39": {
    "zh": "请选择编辑器的 exe 程序",
    "en": "Choose the editor's executable"
  },
  "system.message40": {
    "zh": "自定义编辑器",
    "en": "Custom editor"
  },
  "system.message41": {
    "zh": "编辑器 ID 不正确",
    "en": "Invalid editor ID"
  },
  "system.message42": {
    "zh": "文件路径不正确",
    "en": "Invalid file path"
  },
  "system.message43": {
    "zh": "先选择默认编辑器",
    "en": "Choose a default editor first"
  },
  "system.message44": {
    "zh": "默认编辑器不可用，请重新检测或指定路径",
    "en": "Default editor is unavailable. Detect again or specify its path."
  },
  "system.message45": {
    "zh": "编辑器启动失败：",
    "en": "Editor launch failed:"
  },
  "system.message46": {
    "zh": "项目尚未加载",
    "en": "Project not loaded yet"
  },
  "system.message47": {
    "zh": "会话已不存在",
    "en": "Conversation no longer exists"
  },
  "system.message48": {
    "zh": "项目已不存在",
    "en": "Project no longer exists"
  },
  "system.message49": {
    "zh": "参数 {p0} 不对",
    "en": "Invalid parameter: {p0}"
  },
  "system.message50": {
    "zh": "不受信任的页面",
    "en": "Untrusted page"
  },
  "system.message51": {
    "zh": "未知引擎",
    "en": "Unknown engine"
  },
  "system.message52": {
    "zh": "选择项目文件夹",
    "en": "Choose project folder"
  },
  "system.message53": {
    "zh": "导出用量记录",
    "en": "Export usage records"
  },
  "system.message54": {
    "zh": "文件尚未保存",
    "en": "Unsaved files"
  },
  "system.message55": {
    "zh": "有文件包含未保存的修改，仍然退出吗？",
    "en": "Some files have unsaved changes. Quit anyway?"
  },
  "system.message56": {
    "zh": "返回保存",
    "en": "Return to save"
  },
  "system.message57": {
    "zh": "放弃修改并退出",
    "en": "Discard changes and quit"
  },
  "system.message58": {
    "zh": "[capture] 切换到 {p0} 主题失败（当前 {p1}）",
    "en": "[capture] Could not switch to {p0} theme (current: {p1})"
  },
  "system.message59": {
    "zh": "无",
    "en": "None"
  },
  "system.message60": {
    "zh": "[capture] 浅色和深色截图完全相同，深色主题没有渲染出来",
    "en": "[capture] Light and dark screenshots are identical; dark theme did not render"
  },
  "system.message61": {
    "zh": "文件",
    "en": "File"
  },
  "system.message62": {
    "zh": "窗口",
    "en": "Window"
  },
  "system.message63": {
    "zh": "平台服务暂时不可用，请刷新重试",
    "en": "Platform service temporarily unavailable. Refresh and retry."
  },
  "system.message64": {
    "zh": "平台分组数据格式异常",
    "en": "Invalid platform group data"
  },
  "system.message65": {
    "zh": "平台账号已退出或切换，请登录原账号后重试",
    "en": "Platform account signed out or changed. Sign in to the original account and retry."
  },
  "system.message66": {
    "zh": "排队消息的线路已不可用，请撤回后重新选择",
    "en": "The queued message's route is unavailable. Withdraw it and choose again."
  },
  "system.message67": {
    "zh": "排队消息的模型已不可用，请撤回后重新选择",
    "en": "The queued message's model is unavailable. Withdraw it and choose again."
  },
  "system.message68": {
    "zh": "无效的分组",
    "en": "Invalid group"
  },
  "system.message69": {
    "zh": "平台模型数据格式异常",
    "en": "Invalid platform model data"
  },
  "system.message70": {
    "zh": "这个会话已改用自有额度",
    "en": "This conversation now uses your own account"
  },
  "system.message71": {
    "zh": "平台账号已退出或切换，请重新登录原账号",
    "en": "Platform account signed out or changed. Sign in to the original account again."
  },
  "system.message72": {
    "zh": "平台代理启动失败",
    "en": "Could not start platform proxy"
  },
  "system.message73": {
    "zh": "请登录此会话使用的平台账号",
    "en": "Sign in to this conversation's platform account"
  },
  "system.message74": {
    "zh": "窗口已经关闭",
    "en": "Window closed"
  },
  "system.message75": {
    "zh": "窗口布局不正确",
    "en": "Invalid window layout"
  },
  "system.message76": {
    "zh": "窗口区域不正确",
    "en": "Invalid window region"
  },
  "system.message77": {
    "zh": "当前显示器空间不足，无法使用这个区域",
    "en": "Not enough display space for this region"
  },
  "system.message78": {
    "zh": "缺少项目或会话",
    "en": "Missing project or conversation"
  },
  "system.message79": {
    "zh": "项目目标不正确",
    "en": "Invalid project target"
  },
  "system.message80": {
    "zh": "请使用项目内的相对路径",
    "en": "Use a path relative to the project"
  },
  "system.message81": {
    "zh": "项目目录不存在",
    "en": "Project directory not found"
  },
  "system.message82": {
    "zh": "文件路径超出项目",
    "en": "File path is outside the project"
  },
  "system.message83": {
    "zh": "文件或目录已不存在",
    "en": "File or directory no longer exists"
  },
  "system.message84": {
    "zh": "此链接指向项目外，无法在软件内打开",
    "en": "This link points outside the project and cannot open in the app"
  },
  "system.message85": {
    "zh": "目标不是文件夹",
    "en": "Target is not a folder"
  },
  "system.message86": {
    "zh": "目标不是普通文件",
    "en": "Target is not a regular file"
  },
  "system.message87": {
    "zh": "文件太大，请用外部编辑器打开",
    "en": "File too large. Open it in an external editor."
  },
  "system.message88": {
    "zh": "二进制文件或非 UTF-8 编码，请用外部编辑器打开",
    "en": "Binary or non-UTF-8 file. Open it in an external editor."
  },
  "system.message89": {
    "zh": "暂不支持此文件编码，请用外部编辑器打开",
    "en": "Unsupported encoding. Open it in an external editor."
  },
  "system.message90": {
    "zh": "筛选名称过长",
    "en": "Filter name too long"
  },
  "system.message91": {
    "zh": "保存参数不正确",
    "en": "Invalid save parameters"
  },
  "system.message92": {
    "zh": "内容太大，请用外部编辑器保存",
    "en": "Content too large. Save it with an external editor."
  },
  "system.message93": {
    "zh": "文件路径已经变化，请重新打开",
    "en": "File path changed. Open it again."
  },
  "system.message94": {
    "zh": "文件已变化，请重新加载",
    "en": "File changed. Reload it."
  },
  "system.message95": {
    "zh": "文件已被其他程序修改，请重新加载后再保存；当前草稿仍保留",
    "en": "Another program changed this file. Reload before saving. Your draft is preserved."
  },
  "system.message96": {
    "zh": "打不开项目目录：",
    "en": "Could not open project directory:"
  },
  "system.message97": {
    "zh": "编辑器名称不正确",
    "en": "Invalid editor name"
  },
  "system.message98": {
    "zh": "打开方式不正确",
    "en": "Invalid opening method"
  },
  "system.message99": {
    "zh": "选择编辑器程序",
    "en": "Choose editor executable"
  },
  "system.message100": {
    "zh": "程序",
    "en": "Executable"
  },
  "system.message101": {
    "zh": "没找到 Claude Code。安装：在 PowerShell 运行 irm https://claude.ai/install.ps1 | iex",
    "en": "Claude Code not found. Install it in PowerShell: irm https://claude.ai/install.ps1 | iex"
  },
  "system.message102": {
    "zh": "没找到 Claude Code。安装：在终端运行 curl -fsSL https://claude.ai/install.sh | bash",
    "en": "Claude Code not found. Install it in a terminal: curl -fsSL https://claude.ai/install.sh | bash"
  },
  "system.message103": {
    "zh": "无法运行 Claude Code：{p0}",
    "en": "Could not run Claude Code: {p0}"
  },
  "system.message104": {
    "zh": "版本太低（需要 {p0} 以上）：在终端运行 claude update",
    "en": "Version too old (requires {p0} or later). Run claude update in a terminal."
  },
  "system.message105": {
    "zh": "还没登录 Claude Code：在终端运行 claude auth login",
    "en": "Not signed in to Claude Code. Run claude auth login in a terminal."
  },
  "system.message106": {
    "zh": "这个会话还没有保存记录",
    "en": "This conversation has no saved history yet"
  },
  "system.message107": {
    "zh": "Claude Code 不可用",
    "en": "Claude Code unavailable"
  },
  "system.message108": {
    "zh": "平台代理不可用，请重启应用",
    "en": "Platform proxy unavailable. Restart the app."
  },
  "system.message109": {
    "zh": "没找到 Claude Code",
    "en": "Claude Code not found"
  },
  "system.message110": {
    "zh": "Claude Code 进程已退出",
    "en": "Claude Code process exited"
  },
  "system.message111": {
    "zh": "请求失败",
    "en": "Request failed"
  },
  "system.message112": {
    "zh": "Claude Code 没有回应 {p0}",
    "en": "Claude Code did not respond to {p0}"
  },
  "system.message113": {
    "zh": "模型请求暂时失败",
    "en": "Model request temporarily failed"
  },
  "system.message114": {
    "zh": "这个子智能体还没有保存会话",
    "en": "This subagent has no saved conversation yet"
  },
  "system.message115": {
    "zh": "Claude Code 启动失败",
    "en": "Claude Code failed to start"
  },
  "system.message116": {
    "zh": "免费账号不能使用",
    "en": "Unavailable for free accounts"
  },
  "system.message117": {
    "zh": "账号没有开启 Fast 模式",
    "en": "Fast mode is not enabled for this account"
  },
  "system.message118": {
    "zh": "账号没有开启额外用量",
    "en": "Extra usage is not enabled for this account"
  },
  "system.message119": {
    "zh": "网络错误",
    "en": "Network error"
  },
  "system.message120": {
    "zh": "只支持 Anthropic 官方接口",
    "en": "Only supported by the official Anthropic API"
  },
  "system.message121": {
    "zh": "被环境变量关闭了",
    "en": "Disabled by environment variable"
  },
  "system.message122": {
    "zh": "当前模型不支持",
    "en": "Not supported by this model"
  },
  "system.message123": {
    "zh": "正在确认账号状态",
    "en": "Checking account status"
  },
  "system.message124": {
    "zh": "原因未知",
    "en": "Unknown reason"
  },
  "system.message125": {
    "zh": "无法启动 Claude Code：{p0}",
    "en": "Could not start Claude Code: {p0}"
  },
  "system.message126": {
    "zh": "上下文明细正在刷新",
    "en": "Context details are refreshing"
  },
  "system.message127": {
    "zh": "当前 Claude Code 未提供上下文诊断",
    "en": "This Claude Code version does not provide context diagnostics"
  },
  "system.message128": {
    "zh": "上下文诊断超时，原会话记录保留，可重试",
    "en": "Context diagnostics timed out. Original conversation records are preserved. You can retry."
  },
  "system.message129": {
    "zh": "引擎未提供结构化的上下文明细",
    "en": "Engine did not provide structured context details"
  },
  "system.message130": {
    "zh": "会话已关闭",
    "en": "Conversation closed"
  },
  "system.message131": {
    "zh": "工作目录不存在：{p0}",
    "en": "Working directory not found: {p0}"
  },
  "system.message132": {
    "zh": "无法恢复 Claude Code 的会话记录，已开始新的引擎会话（之前的上下文没有带过去）",
    "en": "Could not restore Claude Code history. Started a new engine session without the previous context."
  },
  "system.message133": {
    "zh": "Fast 模式暂时不可用",
    "en": "Fast mode temporarily unavailable"
  },
  "system.message134": {
    "zh": "Fast 模式没能",
    "en": "Fast mode could not"
  },
  "system.message135": {
    "zh": "打开",
    "en": "enable"
  },
  "system.message136": {
    "zh": "关闭",
    "en": "disable"
  },
  "system.message137": {
    "zh": "Ultracode 没能打开",
    "en": "Could not enable Ultracode"
  },
  "system.message138": {
    "zh": "当前模型不支持 Ultracode，已关闭",
    "en": "Model does not support Ultracode. It was disabled."
  },
  "system.message139": {
    "zh": "上下文诊断进程已退出",
    "en": "Context diagnostic process exited"
  },
  "system.message140": {
    "zh": "Claude Code 意外退出（退出码 {p0}）{p1}",
    "en": "Claude Code exited unexpectedly (exit code {p0}){p1}"
  },
  "system.message141": {
    "zh": "未知",
    "en": "Unknown"
  },
  "system.message142": {
    "zh": "像素星空暂不支持 {p0}",
    "en": "Pixel Starry Sky does not yet support {p0}"
  },
  "system.message143": {
    "zh": "这个请求",
    "en": "this request"
  },
  "system.message144": {
    "zh": "用户希望继续完善计划，先不要开始执行。",
    "en": "The user wants to refine the plan. Do not start execution yet."
  },
  "system.message145": {
    "zh": "用户拒绝了这次操作。",
    "en": "The user denied this operation."
  },
  "system.message146": {
    "zh": "设置没能立即生效：{p0}",
    "en": "Settings could not take effect immediately: {p0}"
  },
  "system.message147": {
    "zh": "当前 Claude 进程尚未通过引导验证",
    "en": "Steering has not been validated for the current Claude process"
  },
  "system.message148": {
    "zh": "引擎没有在运行",
    "en": "Engine is not running"
  },
  "system.message149": {
    "zh": "{p0}\n…（中间省略 {p1} 个字符）…\n{p2}",
    "en": "{p0} … ({p1} characters omitted) … {p2}"
  },
  "system.message150": {
    "zh": "子任务",
    "en": "Subtask"
  },
  "system.message151": {
    "zh": "多智能体编排",
    "en": "Multi-agent orchestration"
  },
  "system.message152": {
    "zh": "向你提问",
    "en": "Question for you"
  },
  "system.message153": {
    "zh": "提交计划",
    "en": "Submit plan"
  },
  "system.message154": {
    "zh": "[图片]",
    "en": "[Image]"
  },
  "system.message155": {
    "zh": "运行命令",
    "en": "Run command"
  },
  "system.message156": {
    "zh": "写入文件",
    "en": "Write file"
  },
  "system.message157": {
    "zh": "修改文件",
    "en": "Edit file"
  },
  "system.message158": {
    "zh": "Claude 想问你",
    "en": "Claude has a question"
  },
  "system.message159": {
    "zh": "计划已就绪，要开始执行吗？",
    "en": "The plan is ready. Start execution?"
  },
  "system.message160": {
    "zh": "使用 {p0}",
    "en": "Use {p0}"
  },
  "system.message161": {
    "zh": "登录已失效：在终端运行 claude auth login 重新登录",
    "en": "Sign-in expired. Run claude auth login in a terminal to sign in again."
  },
  "system.message162": {
    "zh": "当前账号的组织不允许使用 Claude Code",
    "en": "Your organization does not allow Claude Code"
  },
  "system.message163": {
    "zh": "账号已被暂停",
    "en": "Account suspended"
  },
  "system.message164": {
    "zh": "账号需要验证",
    "en": "Account verification required"
  },
  "system.message165": {
    "zh": "账户余额或账单有问题",
    "en": "Account balance or billing issue"
  },
  "system.message166": {
    "zh": "请求太频繁，已触发限额",
    "en": "Too many requests. Rate limit reached."
  },
  "system.message167": {
    "zh": "服务繁忙，请稍后再试",
    "en": "Service busy. Try again later."
  },
  "system.message168": {
    "zh": "请求无效",
    "en": "Invalid request"
  },
  "system.message169": {
    "zh": "找不到所选模型",
    "en": "Selected model not found"
  },
  "system.message170": {
    "zh": "服务出错",
    "en": "Service error"
  },
  "system.message171": {
    "zh": "回复超过了最大长度",
    "en": "Reply exceeded maximum length"
  },
  "system.message172": {
    "zh": "云服务凭据有问题",
    "en": "Cloud service credential issue"
  },
  "system.message173": {
    "zh": "后台命令",
    "en": "Background command"
  },
  "system.message174": {
    "zh": "子智能体",
    "en": "Subagent"
  },
  "system.message175": {
    "zh": "监视任务",
    "en": "Monitor task"
  },
  "system.message176": {
    "zh": "已完成",
    "en": "Completed"
  },
  "system.message177": {
    "zh": "失败",
    "en": "Failed"
  },
  "system.message178": {
    "zh": "已停止",
    "en": "Stopped"
  },
  "system.message179": {
    "zh": "后台任务",
    "en": "Background task"
  },
  "system.message180": {
    "zh": "已结束",
    "en": "Ended"
  },
  "system.message181": {
    "zh": "上下文太长，已自动压缩较早的对话",
    "en": "Context too long. Earlier messages were compacted automatically."
  },
  "system.message182": {
    "zh": "请求出错（{p0}）",
    "en": "Request error ({p0})"
  },
  "system.message183": {
    "zh": "这一轮失败了",
    "en": "This turn failed"
  },
  "system.message184": {
    "zh": "\n本次请求已重试 {p0} 次{p1}。",
    "en": "This request retried {p0} times{p1}."
  },
  "system.message185": {
    "zh": "，达到重试上限",
    "en": ", reaching the retry limit"
  },
  "system.message186": {
    "zh": "超时",
    "en": "Timed out"
  },
  "system.message187": {
    "zh": "{p0}不正确",
    "en": "Invalid {p0}"
  },
  "system.message188": {
    "zh": "名称",
    "en": "name"
  },
  "system.message189": {
    "zh": "名称使用字母、数字、点、下划线或短横线",
    "en": "Use letters, digits, dots, underscores or hyphens for names"
  },
  "system.message190": {
    "zh": "项目路径",
    "en": "project path"
  },
  "system.message191": {
    "zh": "作用范围不正确",
    "en": "Invalid scope"
  },
  "system.message192": {
    "zh": "参数必须为字符串数组",
    "en": "Arguments must be a string array"
  },
  "system.message193": {
    "zh": "环境变量或请求头必须为对象",
    "en": "Environment variables or request headers must be an object"
  },
  "system.message194": {
    "zh": "环境变量或请求头不正确",
    "en": "Invalid environment variables or request headers"
  },
  "system.message195": {
    "zh": "命令",
    "en": "command"
  },
  "system.message196": {
    "zh": "支持 stdio、HTTP 或 SSE",
    "en": "Supports stdio, HTTP or SSE"
  },
  "system.message197": {
    "zh": "地址",
    "en": "URL"
  },
  "system.message198": {
    "zh": "使用 HTTP(S) 地址，凭据放在请求头中",
    "en": "Use an HTTP(S) URL and put credentials in request headers"
  },
  "system.message199": {
    "zh": "不支持的配置类型",
    "en": "Unsupported configuration type"
  },
  "system.message200": {
    "zh": "技能正文",
    "en": "skill content"
  },
  "system.message201": {
    "zh": "路径超出管理目录",
    "en": "Path is outside the managed directory"
  },
  "system.message202": {
    "zh": "配置文件过大",
    "en": "Configuration file too large"
  },
  "system.message203": {
    "zh": "技能正文过大",
    "en": "Skill content too large"
  },
  "system.message204": {
    "zh": "目录层级过深",
    "en": "Directory nesting too deep"
  },
  "system.message205": {
    "zh": "导入目录包含链接，请先使用实际文件：{p0}",
    "en": "Import directory contains links. Use the actual file: {p0}"
  },
  "system.message206": {
    "zh": "导入目录过大",
    "en": "Import directory too large"
  },
  "system.message207": {
    "zh": "插件组件必须位于包内",
    "en": "Plugin components must be inside the package"
  },
  "system.message208": {
    "zh": "随插件启用",
    "en": "Enabled with plugin"
  },
  "system.message209": {
    "zh": "插件可执行程序",
    "en": "Plugin executable"
  },
  "system.message210": {
    "zh": "新会话",
    "en": "New conversation"
  },
  "system.message211": {
    "zh": "环境变量名不对：{p0}",
    "en": "Invalid environment variable name: {p0}"
  },
  "system.message212": {
    "zh": "环境变量 {p0} 的值不对",
    "en": "Invalid value for environment variable {p0}"
  },
  "system.message213": {
    "zh": "输出风格名字太长",
    "en": "Output style name too long"
  },
  "system.message214": {
    "zh": "「允许中途向我提问」的值不对",
    "en": "Invalid value for Allow questions during tasks"
  },
  "system.message215": {
    "zh": "自动压缩触发点不对",
    "en": "Invalid autocompact threshold"
  },
  "system.message216": {
    "zh": "「在菜单中显示」的值不对",
    "en": "Invalid value for Show in menu"
  },
  "system.message217": {
    "zh": "默认引擎不能隐藏，先换一个默认引擎",
    "en": "The default engine cannot be hidden. Choose another default first."
  },
  "system.message218": {
    "zh": "这个引擎暂不支持",
    "en": "This engine is not supported yet"
  },
  "system.message219": {
    "zh": "这个引擎不支持在软件里更新",
    "en": "This engine cannot update within the app"
  },
  "system.message220": {
    "zh": "目录不存在：{p0}",
    "en": "Directory not found: {p0}"
  },
  "system.message221": {
    "zh": "项目不存在",
    "en": "Project not found"
  },
  "system.message222": {
    "zh": "会话不存在",
    "en": "Conversation not found"
  },
  "system.message223": {
    "zh": "任务执行失败",
    "en": "Task execution failed"
  },
  "system.message224": {
    "zh": "引擎退出前未确认是否采纳，请核对后重试",
    "en": "Engine exited before confirming adoption. Check before retrying."
  },
  "system.message225": {
    "zh": "应用正在退出",
    "en": "Application is quitting"
  },
  "system.message226": {
    "zh": "等待当前任务和排队消息结束后刷新明细",
    "en": "Wait for the current task and queued messages to finish before refreshing details"
  },
  "system.message227": {
    "zh": "先运行会话，或升级到支持上下文诊断的 Claude Code",
    "en": "Run a conversation first, or update to a Claude Code version with context diagnostics"
  },
  "system.message228": {
    "zh": "等待当前任务和排队消息结束后压缩",
    "en": "Wait for the current task and queued messages to finish before compacting"
  },
  "system.message229": {
    "zh": "当前引擎不支持原生压缩，或会话尚未开始",
    "en": "Engine does not support native compaction, or the conversation has not started"
  },
  "system.message230": {
    "zh": "这条消息已开始处理或已经撤回",
    "en": "Message processing started or the message was withdrawn"
  },
  "system.message231": {
    "zh": "这条消息已开始交付，无法撤回",
    "en": "Message delivery started; it cannot be withdrawn"
  },
  "system.message232": {
    "zh": "只有排队中的消息可以调序",
    "en": "Only queued messages can be reordered"
  },
  "system.message233": {
    "zh": "正在停止当前任务，请稍后继续",
    "en": "Stopping the current task. Continue later."
  },
  "system.message234": {
    "zh": "请先重试或撤回失败及待核对的消息",
    "en": "Retry or withdraw failed and unverified messages first"
  },
  "system.message235": {
    "zh": "正在停止当前任务，请稍后重试",
    "en": "Stopping the current task. Retry later."
  },
  "system.message236": {
    "zh": "这条消息已经开始交付",
    "en": "Message delivery already started"
  },
  "system.message237": {
    "zh": "这条消息已经开始处理",
    "en": "Message processing already started"
  },
  "system.message238": {
    "zh": "当前任务还没有停止，请稍后重试",
    "en": "Current task has not stopped yet. Retry later."
  },
  "system.message239": {
    "zh": "当前一轮已结束或正在等待审批",
    "en": "Current turn ended or approval is pending"
  },
  "system.message240": {
    "zh": "当前引擎尚未通过运行中引导验证，可等待或插队",
    "en": "Live steering has not been validated for this engine. Wait or run next."
  },
  "system.message241": {
    "zh": "设置与当前任务不同，可等待或插队",
    "en": "Settings differ from the current task. Wait or run next."
  },
  "system.message242": {
    "zh": "引导交付结果待核对：{p0}",
    "en": "Steering delivery needs verification: {p0}"
  },
  "system.message243": {
    "zh": "{p0} 不可用",
    "en": "{p0} unavailable"
  },
  "system.message244": {
    "zh": "上下文诊断正在刷新，完成后再修改会话设置",
    "en": "Context diagnostics are refreshing. Wait before changing session settings."
  },
  "system.message245": {
    "zh": "这一轮结束后再切换额度来源",
    "en": "Switch credit source after this turn finishes"
  },
  "system.message246": {
    "zh": "已经开始对话或有排队任务的会话不能换引擎，请新建会话",
    "en": "Cannot switch engines for conversations that have started or have queued tasks. Create a new conversation."
  },
  "system.message247": {
    "zh": "这个引擎没有智能体追踪",
    "en": "This engine does not provide agent activity"
  },
  "system.message248": {
    "zh": "默认模型不对",
    "en": "Invalid default model"
  },
  "system.message249": {
    "zh": "默认推理强度不对",
    "en": "Invalid default reasoning effort"
  },
  "system.message250": {
    "zh": "默认权限不对",
    "en": "Invalid default permissions"
  },
  "system.message251": {
    "zh": "默认设置 {p0} 的值不对",
    "en": "Invalid value for default setting {p0}"
  },
  "system.message252": {
    "zh": "消息不能为空",
    "en": "Message cannot be empty"
  },
  "system.message253": {
    "zh": "消息过长，请拆分后发送",
    "en": "Message too long. Split it before sending."
  },
  "system.message254": {
    "zh": "消息 ID 无效",
    "en": "Invalid message ID"
  },
  "system.message255": {
    "zh": "排队消息的模型或强度无效",
    "en": "Invalid model or effort for queued message"
  },
  "system.message256": {
    "zh": "排队消息的额度来源无效",
    "en": "Invalid credit source for queued message"
  },
  "system.message257": {
    "zh": "即将支持",
    "en": "Coming soon"
  },
  "system.message258": {
    "zh": "重试次数必须是 0～15 的整数",
    "en": "Retry count must be an integer from 0 to 15"
  },
  "system.message259": {
    "zh": "搜索参数无效",
    "en": "Invalid search parameters"
  },
  "system.message260": {
    "zh": "已移除的项目",
    "en": "Removed project"
  },
  "system.message261": {
    "zh": "最近会话",
    "en": "Recent conversations"
  },
  "system.message262": {
    "zh": "项目",
    "en": "Projects"
  },
  "system.message263": {
    "zh": "会话 id 不合法：{p0}",
    "en": "Invalid conversation ID: {p0}"
  },
  "system.message264": {
    "zh": "上次退出前已开始交付，请核对后再重试",
    "en": "Delivery began before the previous exit. Check before retrying."
  },
  "nav.workbench": {
    "zh": "工作台",
    "en": "Workbench"
  },
  "nav.machines": {
    "zh": "云主机",
    "en": "Cloud machines"
  },
  "nav.channels": {
    "zh": "协作频道",
    "en": "Channels"
  },
  "nav.skills": {
    "zh": "技能与插件",
    "en": "Skills & plugins"
  },
  "panel.copies": {
    "zh": "副本",
    "en": "Copies"
  },
  "panel.sandbox": {
    "zh": "环境",
    "en": "Environment"
  },
  "panel.browser": {
    "zh": "浏览器",
    "en": "Browser"
  },
  "panel.tasks": {
    "zh": "任务清单",
    "en": "Tasks"
  },
  "composer.placeholder": {
    "zh": "描述你要做的事，@ 添加文件，/ 输入命令",
    "en": "Describe your task, @ add files, / enter commands"
  },
  "composer.machine": {
    "zh": "这台电脑",
    "en": "This computer"
  },
  "system.rewindRunning": {
    "zh": "请先停止当前任务再回退",
    "en": "Stop the current task before rewinding"
  },
  "system.rewindUnsupported": {
    "zh": "当前引擎暂不支持回退",
    "en": "The current engine does not support rewinding yet"
  },
  "system.rewindOwnOnly": {
    "zh": "只能回退到自己发送的消息",
    "en": "You can only rewind to messages you sent"
  },
  "system.rewindAnchorMissing": {
    "zh": "无法在 Claude Code 记录中回退到这条消息，已开始新的引擎会话（之前的上下文没有带过去）",
    "en": "Could not rewind to this message in Claude Code history. Started a new engine session without the previous context."
  },
  "system.programNotFound": {
    "zh": "找不到程序：{p0}",
    "en": "Program not found: {p0}"
  }
} as const
