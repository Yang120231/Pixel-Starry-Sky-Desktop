// 软件内置语言：文件名 / 扩展名 → 显示名（和 languages.ts 的 loadLanguage 一一对应）。
// 从 languages.ts 拆出来，让扩展语法（languageIds.ts）和内置语言共用同一份认法，不必加载 CodeMirror 语言包

const extensions: Record<string, string> = {
  ts: 'TypeScript',
  mts: 'TypeScript',
  cts: 'TypeScript',
  tsx: 'TSX',
  js: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  jsx: 'JSX',
  json: 'JSON',
  jsonc: 'JSON',
  css: 'CSS',
  html: 'HTML',
  htm: 'HTML',
  md: 'Markdown',
  markdown: 'Markdown',
  py: 'Python',
  rs: 'Rust',
  go: 'Go',
  yaml: 'YAML',
  yml: 'YAML',
  toml: 'TOML',
  sh: 'Shell',
  bash: 'Shell',
  zsh: 'Shell',
  sql: 'SQL',
  java: 'Java',
  kt: 'Kotlin',
  kts: 'Kotlin',
  scala: 'Scala',
  sc: 'Scala',
  groovy: 'Groovy',
  gradle: 'Groovy',
  c: 'C',
  h: 'C',
  cpp: 'C++',
  cc: 'C++',
  cxx: 'C++',
  hpp: 'C++',
  hh: 'C++',
  hxx: 'C++',
  cs: 'C#',
  xml: 'XML',
  xsd: 'XML',
  xsl: 'XML',
  xslt: 'XML',
  svg: 'XML',
  fxml: 'XML',
  plist: 'XML',
  csproj: 'XML',
  properties: 'Properties',
  ini: 'INI',
  cfg: 'INI',
  dockerfile: 'Dockerfile',
}

/** 内置语言的显示名；认不出返回 null（显示名里没有「纯文本」，那是 fileLanguage 的兜底） */
export function builtinLanguageName(path: string): string | null {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  // Dockerfile 常常没有扩展名，或者写成 Dockerfile.dev
  if (/^(docker|container)file(\..+)?$/.test(name)) return 'Dockerfile'
  return extensions[name.split('.').pop() ?? ''] ?? null
}
