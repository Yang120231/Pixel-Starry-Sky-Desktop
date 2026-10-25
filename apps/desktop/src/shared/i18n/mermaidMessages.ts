// 回复里的 Mermaid 图表（docs/ui/mermaid.md）
export const mermaidMessages = {
  'mermaid.view': { zh: '图', en: 'Diagram' },
  'mermaid.source': { zh: '源码', en: 'Source' },
  'mermaid.switch': { zh: '源码 / 图', en: 'Source / diagram' },
  'mermaid.zoom': { zh: '放大查看', en: 'Enlarge' },
  'mermaid.loading': { zh: '正在加载图表…', en: 'Loading diagram…' },
  'mermaid.diagramLabel': { zh: 'Mermaid 图表', en: 'Mermaid diagram' },
  'mermaid.failed': {
    zh: '图表渲染失败，已显示源码：{reason}',
    en: "Couldn't render the diagram; showing the source: {reason}",
  },
  'mermaid.failedLine': { zh: '第 {line} 行附近 ', en: 'near line {line}: ' },
  'mermaid.retry': { zh: '重试', en: 'Retry' },
} as const
