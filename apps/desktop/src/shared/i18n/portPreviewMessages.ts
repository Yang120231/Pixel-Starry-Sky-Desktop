// 对话里发现本机端口的提示条、浏览器面板空状态的端口入口（docs/ui/port-preview.md）
export const portPreviewMessages = {
  'portTip.one': { zh: '发现本机页面', en: 'Local page found' },
  'portTip.many': { zh: '发现 {n} 个本机页面', en: '{n} local pages found' },
  'portTip.open': { zh: '在内置浏览器打开', en: 'Open in built-in browser' },
  'portTip.openPort': { zh: '打开 :{port}', en: 'Open :{port}' },
  'portTip.opened': { zh: '已在内置浏览器打开', en: 'Opened in the built-in browser' },
  'portTip.show': { zh: '显示', en: 'Show' },
  'portTip.copy': { zh: '复制地址', en: 'Copy address' },
  'portTip.ignore': { zh: '忽略', en: 'Dismiss' },
  'portTip.ignoreAll': { zh: '全部忽略', en: 'Dismiss all' },
  'portTip.expand': { zh: '展开', en: 'Expand' },
  'portTip.collapse': { zh: '收起', en: 'Collapse' },
  'portTip.manualHint': {
    zh: '输入网址或本机端口，在这里预览页面',
    en: 'Enter an address or a local port to preview a page here',
  },
  'portTip.portPlaceholder': { zh: '端口', en: 'port' },
  'portTip.portInvalid': { zh: '输入 1–65535 的端口', en: 'Enter a port from 1 to 65535' },
  'portTip.found': { zh: '本会话发现的端口', en: 'Ports found in this session' },
} as const
