import type { McpConfig } from '@pixelsky/protocol'
/** 添加表单模板，不是已安装或已连接的数据；由用户保存后才生效。 */
export const extensionTemplates:Array<{name:string;description:string;mcp:McpConfig;docs:string}>=[
  {name:'playwright',description:'浏览器自动化',mcp:{type:'stdio',command:'npx',args:['-y','@playwright/mcp@0.0.83']},docs:'https://github.com/microsoft/playwright-mcp'},
  {name:'context7',description:'库文档与代码示例',mcp:{type:'stdio',command:'npx',args:['-y','@upstash/context7-mcp@4.1.1']},docs:'https://github.com/upstash/context7'},
]
