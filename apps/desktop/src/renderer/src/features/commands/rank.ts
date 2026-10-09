export interface SearchableCommand {
  id: string
  label: string
  keywords: string
  category: string
}
export function rankCommands<T extends SearchableCommand>(commands: T[], query: string, history: string[]): T[] {
  const normalized = query.trim().toLocaleLowerCase(),
    words = normalized.split(/\s+/).filter(Boolean)
  const recent = (id: string): number => {
    const n = history.indexOf(id)
    return n >= 0 && n < 8 ? n : 99
  }
  return commands
    .map((item, order) => {
      const label = item.label.toLocaleLowerCase(),
        haystack = (label + ' ' + item.keywords + ' ' + item.category).toLocaleLowerCase()
      const score = !words.length
        ? 0
        : !words.every(word => haystack.includes(word))
          ? -1
          : label === normalized
            ? 3
            : label.startsWith(normalized)
              ? 2
              : 1
      return { item, order, score }
    })
    .filter(item => item.score >= 0)
    .sort((a, b) => b.score - a.score || recent(a.item.id) - recent(b.item.id) || a.order - b.order)
    .map(item => item.item)
}
