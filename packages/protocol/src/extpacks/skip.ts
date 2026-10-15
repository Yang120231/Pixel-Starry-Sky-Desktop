// 文件夹遍历、内存来源和打包共用的「当作不存在」的条目（authoring-spec §2.1）。zip 输入不套用这个。

const SKIP_SEGMENTS = new Set(['.git', 'node_modules', '__MACOSX'])
const SKIP_FILES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini'])

/**
 * path 是正斜杠相对路径。命中就当作不存在：
 * 1. 任何一段是 .git / node_modules / __MACOSX（它们下面的一切也一样）；
 * 2. 文件名是 .DS_Store / Thumbs.db / desktop.ini（大小写不分，任何深度，samples 里也一样）；
 * 3. 不在 samples/ 里时，任何以 . 开头的段（点开头的文件夹也因此成了放构建源文件的「逃生口」）；
 * 4. 根目录下的 *.zip / *.vsix。
 * kind 目前不影响判断（目录和文件规则相同），留着是给以后加规则用。
 */
export function extPackSkipped(path: string, _kind: 'dir' | 'file' | 'symlink'): boolean {
  const segs = path.split('/')
  if (segs.some(s => SKIP_SEGMENTS.has(s))) return true
  if (SKIP_FILES.has(segs[segs.length - 1].toLowerCase())) return true
  if (segs[0] !== 'samples' || segs.length === 1) {
    if (segs.some(s => s.startsWith('.'))) return true
  }
  if (segs.length === 1 && /\.(zip|vsix)$/i.test(segs[0])) return true
  return false
}
