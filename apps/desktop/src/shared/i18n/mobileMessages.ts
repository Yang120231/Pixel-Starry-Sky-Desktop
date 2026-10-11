// 手机远程连接（docs/mobile-remote.md §5.4）：设置 › 手机
export const mobileMessages = {
  'mobile.title': { zh: '手机', en: 'Phone' },
  'mobile.intro': {
    zh: '离开电脑时用手机看任务、审批、回答提问、发消息。内容端到端加密，中转服务器看不到。',
    en: 'Use your phone to follow tasks, approve, answer questions and send messages while away. Everything is end-to-end encrypted; the relay cannot read it.',
  },
  'mobile.enable': { zh: '允许手机远程连接', en: 'Allow phone connections' },
  'mobile.enableDesc': {
    zh: '关掉后手机连不上，已配对的手机保留。',
    en: 'Phones cannot connect while this is off. Paired phones are kept.',
  },
  'mobile.relay': { zh: '中转地址', en: 'Relay address' },
  'mobile.relayDesc': {
    zh: '留空就用云端中转（和登录是同一个服务）。只有本机测试时才需要填。',
    en: 'Leave empty to use the cloud relay (the same service you sign in to). Only needed for local testing.',
  },
  'mobile.relaySave': { zh: '保存', en: 'Save' },
  'mobile.keepAwake': { zh: '有任务运行时不让电脑睡眠', en: 'Keep the computer awake while tasks run' },
  'mobile.keepAwakeDesc': {
    zh: '电脑睡眠后手机就连不上了。只在有任务运行时生效。',
    en: 'Phones cannot reach a sleeping computer. Only applies while a task is running.',
  },
  'mobile.status.off': { zh: '未开启', en: 'Off' },
  'mobile.status.connecting': { zh: '正在连接中转…', en: 'Connecting to the relay…' },
  'mobile.status.online': { zh: '已连上中转，手机可以连接', en: 'Connected to the relay. Phones can connect.' },
  'mobile.status.error': { zh: '连不上中转，稍后自动重试', en: 'Cannot reach the relay. Retrying shortly.' },
  'mobile.fingerprint': { zh: '本机指纹 {p0}', en: 'This computer’s fingerprint {p0}' },
  'mobile.devices': { zh: '已配对的手机', en: 'Paired phones' },
  'mobile.noDevices': { zh: '还没有配对手机。', en: 'No paired phones yet.' },
  'mobile.add': { zh: '添加手机', en: 'Add phone' },
  'mobile.online': { zh: '已连接', en: 'Connected' },
  'mobile.lastSeen': { zh: '上次连接 {p0}', en: 'Last connected {p0}' },
  'mobile.neverSeen': { zh: '还没连接过', en: 'Never connected' },
  'mobile.access.act': { zh: '可审批和发消息', en: 'Can approve and send' },
  'mobile.access.view': { zh: '只看', en: 'View only' },
  'mobile.revoke': { zh: '移除', en: 'Remove' },
  'mobile.revokeConfirm': {
    zh: '移除「{p0}」？它会立刻断开，要再用得重新扫码配对。',
    en: 'Remove “{p0}”? It disconnects immediately and must scan the code again to reconnect.',
  },
  'mobile.pairTitle': { zh: '用手机扫码', en: 'Scan with your phone' },
  'mobile.pairHint': {
    zh: '二维码 {p0} 后失效。扫码后要在这台电脑上确认。',
    en: 'The code expires in {p0}. You will confirm on this computer after scanning.',
  },
  'mobile.pairExpired': { zh: '二维码已过期。', en: 'The code has expired.' },
  'mobile.pairRetry': { zh: '重新生成', en: 'New code' },
  'mobile.pairCancel': { zh: '取消', en: 'Cancel' },
  'mobile.pairConfirm': { zh: '「{p0}」请求连接这台电脑', en: '“{p0}” wants to connect to this computer' },
  'mobile.pairConfirmHint': {
    zh: '核对手机上显示的指纹是否也是 {p0}。允许后它能看到这台电脑上的所有任务。',
    en: 'Check that the phone shows the same fingerprint {p0}. Once allowed, it can see every task on this computer.',
  },
  'mobile.pairAllow': { zh: '允许', en: 'Allow' },
  'mobile.pairDeny': { zh: '拒绝', en: 'Deny' },
  'mobile.pairDone': { zh: '已配对', en: 'Paired' },
  'mobile.pairRejected': { zh: '已拒绝', en: 'Denied' },
  'mobile.error.MOBILE_BAD_RELAY': {
    zh: '先填一个中转地址（ws:// 或 wss://）。',
    en: 'Enter a relay address (ws:// or wss://) first.',
  },
  'mobile.error.MOBILE_NO_CIPHER': {
    zh: '系统加密不可用，不能保存配对用的密钥。',
    en: 'System encryption is unavailable, so the pairing key cannot be stored.',
  },
  'mobile.error.MOBILE_RELAY_OFFLINE': {
    zh: '连不上中转，稍后自动重试。',
    en: 'Cannot reach the relay. Retrying shortly.',
  },
  'mobile.error.MOBILE_RELAY_REJECTED': { zh: '中转拒绝了连接。', en: 'The relay refused the connection.' },
  'mobile.error.MOBILE_NEED_LOGIN': {
    zh: '先登录平台账号（左下角），手机才能经云端连到这台电脑。',
    en: 'Sign in to your platform account (bottom left) so phones can reach this computer through the cloud.',
  },
  'mobile.error.MOBILE_NOT_OWNER': {
    zh: '这台电脑在云端绑定的是另一个账号。',
    en: 'This computer is linked to a different account in the cloud.',
  },
  'mobile.error.MOBILE_NOT_FOUND': {
    zh: '云端已经没有这部手机了。',
    en: 'The cloud no longer has this phone.',
  },
  'mobile.error.MOBILE_SERVER_ERROR': {
    zh: '云端出错了，稍后再试。',
    en: 'The cloud ran into an error. Try again later.',
  },
  'mobile.error.MOBILE_TOO_MANY_DEVICES': {
    zh: '最多配对 5 部手机，先移除一部。',
    en: 'Up to 5 phones can be paired. Remove one first.',
  },
}
