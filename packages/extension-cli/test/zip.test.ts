import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { zipSync } from 'fflate'
import { afterAll, describe, expect, it } from 'vitest'
import { EXT_LIMITS } from '@pixelsky/protocol/extpacks'
import type { ExtPackFiles } from '@pixelsky/protocol/extpacks'
import { crc32 } from '../src/lib/crc32'
import { readPackZip, writePackZip } from '../src/lib/zip'
import { buildRawZip, MINIMAL_MANIFEST } from './helpers/rawZip'

const enc = new TextEncoder()
const dec = new TextDecoder()
const here = dirname(fileURLToPath(import.meta.url))
const made: string[] = []
afterAll(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** 内存里的 ExtPackFiles */
function memory(files: Record<string, Uint8Array | string>): ExtPackFiles {
  const map = new Map(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? enc.encode(v) : v]))
  return {
    entries: [...map].map(([path, v]) => ({ path, size: v.length, kind: 'file' as const })),
    truncated: false,
    stat: p => map.get(p)?.length ?? null,
    read: (p, max) => map.get(p)?.subarray(0, max) ?? null,
  }
}
const codes = (z: ExtPackFiles): string[] => (z.preIssues ?? []).map(i => i.code)
const paths = (z: ExtPackFiles): string[] => z.entries.map(e => e.path)
const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')

describe('crc32', () => {
  it('matches the standard check values', () => {
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array(0))).toBe(0)
  })
})

describe('writePackZip', () => {
  const sample = {
    'pixelsky-extension.json': MINIMAL_MANIFEST,
    'samples/example.env': 'A=1\nB=2\n',
    'icons/a.png': Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]),
    'README.md': '你好，世界\n'.repeat(50),
  }

  it('round-trips through readPackZip', () => {
    const src = memory(sample)
    const zip = writePackZip(src, Object.keys(sample))
    const back = readPackZip(zip)
    expect(back.preIssues).toEqual([])
    expect(paths(back)).toEqual(Object.keys(sample).sort())
    for (const [p, v] of Object.entries(sample)) {
      const want = typeof v === 'string' ? enc.encode(v) : v
      expect(back.read(p, 1e6)).toEqual(want)
      expect(back.stat(p)).toBe(want.length)
    }
  })

  it('is deterministic whatever the order of the paths', () => {
    const src = memory(sample)
    const keys = Object.keys(sample)
    const a = writePackZip(src, keys)
    const b = writePackZip(src, [...keys].reverse())
    expect(sha(a)).toBe(sha(b))
    expect(a).toEqual(b)
  })

  it('writes the same bytes in every time zone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pxext-zip-'))
    made.push(dir)
    const out = join(dir, 'zipw.mjs')
    buildSync({
      stdin: {
        contents: `import { writePackZip } from './zip-write'
          import { createHash } from 'node:crypto'
          const files = { 'a.json': new TextEncoder().encode('{}'), 'b/中.md': new TextEncoder().encode('hello'.repeat(40)) }
          const src = { entries: [], truncated: false, stat: () => null, read: p => files[p] ?? null }
          process.stdout.write(createHash('sha256').update(writePackZip(src, Object.keys(files))).digest('hex'))`,
        resolveDir: join(here, '..', 'src', 'lib'),
        loader: 'ts',
      },
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: out,
      logLevel: 'silent',
    })
    const run = (tz: string): string => {
      const r = spawnSync(process.execPath, [out], { env: { ...process.env, TZ: tz }, encoding: 'utf8' })
      expect(r.status, r.stderr).toBe(0)
      return r.stdout
    }
    const ny = run('America/New_York')
    expect(ny).toMatch(/^[0-9a-f]{64}$/)
    expect(run('Asia/Shanghai')).toBe(ny)
    expect(run('UTC')).toBe(ny)
  })

  /** 读 zip 里每个中央头：名字、标志位、方法、时间日期、额外字段长度、外部属性 */
  function centralHeaders(zip: Uint8Array) {
    const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    let e = zip.length - 22
    while (v.getUint32(e, true) !== 0x06054b50) e--
    let p = v.getUint32(e + 16, true)
    const out = []
    for (let i = 0; i < v.getUint16(e + 10, true); i++) {
      const n = v.getUint16(p + 28, true)
      const lo = v.getUint32(p + 42, true)
      out.push({
        name: dec.decode(zip.subarray(p + 46, p + 46 + n)),
        flags: v.getUint16(p + 8, true),
        localFlags: v.getUint16(lo + 6, true),
        method: v.getUint16(p + 10, true),
        time: v.getUint16(p + 12, true),
        date: v.getUint16(p + 14, true),
        extra: v.getUint16(p + 30, true),
        comment: v.getUint16(p + 32, true),
        madeBy: v.getUint16(p + 4, true),
        attrs: v.getUint32(p + 38, true),
        localExtra: v.getUint16(lo + 28, true),
      })
      p += 46 + n + v.getUint16(p + 30, true) + v.getUint16(p + 32, true)
    }
    return out
  }

  it('writes files only, stored png, UTF-8 flag, fixed DOS time, no extra fields', () => {
    const zip = writePackZip(memory({ ...sample, 'snippets/中文.json': '{}' }), [
      ...Object.keys(sample),
      'snippets/中文.json',
    ])
    const hs = centralHeaders(zip)
    expect(hs.every(h => !h.name.endsWith('/'))).toBe(true)
    expect(hs.map(h => h.name)).toEqual([...hs.map(h => h.name)].sort())
    expect(hs.find(h => h.name === 'icons/a.png')!.method).toBe(0)
    expect(hs.find(h => h.name === 'README.md')!.method).toBe(8)
    const cn = hs.find(h => h.name === 'snippets/中文.json')!
    expect(cn.flags & 0x800).toBe(0x800)
    expect(cn.localFlags & 0x800).toBe(0x800)
    for (const h of hs) {
      expect(h.date, h.name).toBe(((1980 - 1980) << 9) | (1 << 5) | 1)
      expect(h.time, h.name).toBe(0)
      expect(h.extra, h.name).toBe(0)
      expect(h.localExtra, h.name).toBe(0)
      expect(h.comment, h.name).toBe(0)
      expect(h.attrs, h.name).toBe(0)
      expect(h.madeBy >> 8, h.name).toBe(0)
    }
  })

  it('packs a file literally named __proto__', () => {
    const map = new Map<string, Uint8Array>([
      ['pixelsky-extension.json', enc.encode(MINIMAL_MANIFEST)],
      ['__proto__', enc.encode('p')],
    ])
    const src: ExtPackFiles = {
      entries: [...map].map(([path, v]) => ({ path, size: v.length, kind: 'file' as const })),
      truncated: false,
      stat: q => map.get(q)?.length ?? null,
      read: q => map.get(q) ?? null,
    }
    const back = readPackZip(writePackZip(src, [...map.keys()]))
    expect(paths(back)).toEqual(['__proto__', 'pixelsky-extension.json'])
    expect(back.read('__proto__', 10)).toEqual(enc.encode('p'))
  })

  it('throws when a path cannot be read', () => {
    expect(() => writePackZip(memory({ a: 'x' }), ['a', 'missing'])).toThrow(/missing/)
  })
})

describe('readPackZip: malformed input', () => {
  const ok = { name: 'pixelsky-extension.json', data: MINIMAL_MANIFEST }

  it('reads a plain zip made by fflate', () => {
    const z = readPackZip(
      zipSync({ 'pixelsky-extension.json': enc.encode(MINIMAL_MANIFEST), 'a/b.txt': enc.encode('hi') }),
    )
    expect(z.preIssues).toEqual([])
    expect(paths(z)).toEqual(['a/b.txt', 'pixelsky-extension.json'])
  })

  it('ignores directory entries', () => {
    const z = readPackZip(buildRawZip([ok, { name: 'samples/', data: '', method: 0 }]))
    expect(paths(z)).toEqual(['pixelsky-extension.json'])
    expect(codes(z)).toEqual([])
  })

  it('zip.tooLarge for more than packBytes, without parsing', () => {
    const z = readPackZip(new Uint8Array(EXT_LIMITS.packBytes + 1))
    expect(codes(z)).toEqual(['zip.tooLarge'])
    expect(z.entries).toEqual([])
    expect(z.read('x', 10)).toBeNull()
  })

  it('zip.invalid for garbage, empty input and a missing EOCD', () => {
    for (const bytes of [
      enc.encode('this is not a zip file at all'),
      new Uint8Array(0),
      buildRawZip([ok], { noEocd: true }),
    ]) {
      const z = readPackZip(bytes)
      expect(codes(z)).toEqual(['zip.invalid'])
      expect(z.entries).toEqual([])
    }
  })

  it('zip.invalid for zip64 markers and multi-disk', () => {
    expect(codes(readPackZip(buildRawZip([ok], { eocd: { count: 0xffff, countHere: 0xffff } })))).toEqual([
      'zip.invalid',
    ])
    expect(codes(readPackZip(buildRawZip([ok], { eocd: { cdOffset: 0xffffffff } })))).toEqual(['zip.invalid'])
    expect(codes(readPackZip(buildRawZip([ok], { eocd: { cdSize: 0xffffffff } })))).toEqual(['zip.invalid'])
    expect(codes(readPackZip(buildRawZip([ok], { eocd: { disk: 1 } })))).toEqual(['zip.invalid'])
  })

  it('zip.invalid when the central directory lies about its extent', () => {
    expect(codes(readPackZip(buildRawZip([ok], { eocd: { cdOffset: 100000 } })))).toEqual(['zip.invalid'])
    expect(codes(readPackZip(buildRawZip([ok], { eocd: { cdSize: 100000 } })))).toEqual(['zip.invalid'])
    expect(codes(readPackZip(buildRawZip([ok], { eocd: { count: 5, countHere: 5 } })))).toEqual(['zip.invalid'])
  })

  it('never throws for truncated or bit-flipped real zips', () => {
    const good = writePackZip(memory({ 'pixelsky-extension.json': MINIMAL_MANIFEST, 'a.txt': 'hello world' }), [
      'pixelsky-extension.json',
      'a.txt',
    ])
    for (let cut = 0; cut < good.length; cut += 7) {
      const z = readPackZip(good.subarray(0, cut))
      expect(z.preIssues!.length).toBeGreaterThan(0)
    }
    for (let i = 0; i < good.length; i++) {
      const bad = good.slice()
      bad[i] = bad[i]! ^ 0xff
      expect(() => readPackZip(bad)).not.toThrow()
    }
  })

  it('zip.entryName for traversal, absolute, drive, backslash, control chars, dot and empty segments', () => {
    const names = [
      '../evil.txt',
      'a/../../evil',
      '/abs.txt',
      'C:/win.ini',
      'C:x',
      'a\\b.txt',
      'a\u0001b',
      'a\u007fb',
      './x',
      'a/./b',
      'a//b',
    ]
    const z = readPackZip(buildRawZip([ok, ...names.map(name => ({ name, data: 'x' }))]))
    expect(codes(z)).toEqual(names.map(() => 'zip.entryName'))
    expect(paths(z)).toEqual(['pixelsky-extension.json'])
    expect(z.preIssues!.map(i => i.path)).toEqual(names)
  })

  it('zip.nameEncoding for a non-UTF-8 name without the flag, and invalid UTF-8 with it', () => {
    const gbk = Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4, 0x2e, 0x74, 0x78, 0x74]) // 中文.txt in GBK
    const z = readPackZip(buildRawZip([ok, { name: gbk, data: 'x' }, { name: gbk, data: 'y', flags: 0x800 }]))
    expect(codes(z)).toEqual(['zip.nameEncoding', 'zip.nameEncoding'])
    expect(paths(z)).toEqual(['pixelsky-extension.json'])
  })

  it('accepts a UTF-8 name with the flag, and a plain ASCII name without it', () => {
    const z = readPackZip(
      buildRawZip([ok, { name: '中文/文件.txt', data: 'x' }, { name: 'plain.txt', data: 'y', flags: 0 }]),
    )
    expect(codes(z)).toEqual([])
    expect(paths(z)).toEqual(['pixelsky-extension.json', 'plain.txt', '中文/文件.txt'])
  })

  it('keeps a leading BOM in an entry name instead of stripping it', () => {
    const bom = String.fromCharCode(0xfeff)
    const z = readPackZip(buildRawZip([ok, { name: bom + 'a.json', data: 'x' }]))
    expect(paths(z)).toContain(bom + 'a.json')
    expect(z.stat('a.json')).toBeNull()
  })

  it('zip.duplicate keeps the first entry', () => {
    const z = readPackZip(buildRawZip([ok, { name: 'a.txt', data: 'first' }, { name: 'a.txt', data: 'second' }]))
    expect(codes(z)).toEqual(['zip.duplicate'])
    expect(dec.decode(z.read('a.txt', 100)!)).toBe('first')
  })

  it('leaves case-only duplicates to the rules', () => {
    const z = readPackZip(buildRawZip([ok, { name: 'a.txt', data: '1' }, { name: 'A.txt', data: '2' }]))
    expect(codes(z)).toEqual([])
    expect(paths(z)).toEqual(['A.txt', 'a.txt', 'pixelsky-extension.json'])
  })

  it('zip.unsupported for encryption and unknown methods', () => {
    const z = readPackZip(
      buildRawZip([
        ok,
        { name: 'enc.txt', data: 'x', flags: 0x1 },
        { name: 'bz.txt', data: 'x', method: 12, rawData: Uint8Array.from([1, 2]) },
      ]),
    )
    expect(codes(z)).toEqual(['zip.unsupported', 'zip.unsupported'])
    expect(paths(z)).toEqual(['pixelsky-extension.json'])
  })

  it('turns a unix symlink entry into kind symlink with size 0', () => {
    const z = readPackZip(
      buildRawZip([ok, { name: 'link', data: '../x', madeBy: (3 << 8) | 20, extAttr: (0o120777 << 16) >>> 0 }]),
    )
    expect(z.entries.find(e => e.path === 'link')).toEqual({ path: 'link', size: 0, kind: 'symlink' })
    expect(z.stat('link')).toBeNull()
    expect(z.read('link', 100)).toBeNull()
    expect(codes(z)).toEqual([])
  })

  it('does not treat a regular unix file as a symlink', () => {
    const z = readPackZip(
      buildRawZip([ok, { name: 'f', data: 'x', madeBy: (3 << 8) | 20, extAttr: (0o100644 << 16) >>> 0 }]),
    )
    expect(z.entries.find(e => e.path === 'f')!.kind).toBe('file')
  })

  it('zip.corrupt for a CRC mismatch, a wrong length and a truncated stream', () => {
    const z = readPackZip(
      buildRawZip([
        ok,
        { name: 'crc.txt', data: 'hello', crc: 1234 },
        { name: 'len.txt', data: 'hello', usize: 3 },
        { name: 'cut.txt', data: 'hello hello hello hello', rawData: Uint8Array.from([0xcb, 0x48]) },
        { name: 'stored.txt', data: 'hello', method: 0, usize: 9 },
      ]),
    )
    expect(codes(z)).toEqual(['zip.corrupt', 'zip.corrupt', 'zip.corrupt', 'zip.corrupt'])
    expect(z.read('crc.txt', 100)).toBeNull()
    expect(z.read('len.txt', 100)).toBeNull()
    expect(z.read('cut.txt', 100)).toBeNull()
    expect(z.read('ok', 100)).toBeNull()
    expect(codes(z)).toHaveLength(4) // 重复读不会重复报
    expect(z.preIssues!.map(i => i.path)).toEqual(['crc.txt', 'cut.txt', 'len.txt', 'stored.txt'])
  })

  it('zip.corrupt for a stream that inflates past its declared size', () => {
    const big = 'a'.repeat(100_000)
    const z = readPackZip(buildRawZip([ok, { name: 'bomb.txt', data: big, usize: 10, crc: crc32(enc.encode(big)) }]))
    expect(codes(z)).toEqual(['zip.corrupt'])
    expect(z.read('bomb.txt', 100)).toBeNull()
  })

  it('zip.corrupt for a data range running past the end of the file', () => {
    const z = readPackZip(buildRawZip([ok, { name: 'x.txt', data: 'abc', method: 0, csize: 5000, usize: 3 }]))
    expect(codes(z)).toEqual(['zip.corrupt'])
  })

  it('a declared 1 GB entry is neither inflated nor allocated; it is reported by stat', () => {
    const z = readPackZip(buildRawZip([ok, { name: 'z-huge.bin', data: 'x', usize: 1_000_000_000 }]))
    expect(codes(z)).toEqual([])
    expect(z.stat('z-huge.bin')).toBe(1_000_000_000)
    expect(z.read('z-huge.bin', 100)).toBeNull()
    // 1 GB > scanBytes (50 MB)：截断，z-huge.bin 本身列不进去
    expect(z.truncated).toBe(true)
    expect(paths(z)).toEqual(['pixelsky-extension.json'])
  })

  it('does not inflate when truncated, but still reads small entries lazily', () => {
    const z = readPackZip(
      buildRawZip([ok, { name: 'a.txt', data: 'abc', crc: 5 }, { name: 'z.bin', data: 'x', usize: 60_000_000 }]),
    )
    expect(z.truncated).toBe(true)
    expect(codes(z)).toEqual([]) // 没有一次性验证
    expect(z.read('a.txt', 100)).toBeNull() // 懒读时才发现 CRC 不对
    expect(codes(z)).toEqual(['zip.corrupt'])
    expect(dec.decode(z.read('pixelsky-extension.json', 5)!)).toBe(MINIMAL_MANIFEST.slice(0, 5))
  })

  it('truncated by entry count', () => {
    const many = Array.from({ length: EXT_LIMITS.scanFiles + 3 }, (_, i) => ({
      name: `f${String(i).padStart(5, '0')}`,
      data: '',
    }))
    const z = readPackZip(buildRawZip(many))
    expect(z.truncated).toBe(true)
    expect(z.entries).toHaveLength(EXT_LIMITS.scanFiles)
  })

  it('files above fileBytes are listed with their declared size but not read', () => {
    const data = new Uint8Array(EXT_LIMITS.fileBytes + 1)
    const z = readPackZip(buildRawZip([ok, { name: 'big.bin', data }]))
    expect(z.stat('big.bin')).toBe(data.length)
    expect(z.read('big.bin', 10)).toBeNull()
    expect(codes(z)).toEqual([])
  })

  it('zip.nested when everything sits in one top-level folder holding the manifest', () => {
    const z = readPackZip(
      buildRawZip([
        { name: 'my-ext/pixelsky-extension.json', data: MINIMAL_MANIFEST },
        { name: 'my-ext/samples/a.txt', data: 'x' },
      ]),
    )
    expect(codes(z)).toEqual(['zip.nested'])
    expect(z.preIssues![0]!.message.zh).toContain('my-ext/')
  })

  it('no zip.nested when the manifest is at the root, or the folders differ, or there is no manifest', () => {
    expect(codes(readPackZip(buildRawZip([ok, { name: 'x/pixelsky-extension.json', data: '{}' }])))).toEqual([])
    expect(
      codes(
        readPackZip(
          buildRawZip([
            { name: 'a/pixelsky-extension.json', data: '{}' },
            { name: 'b/c.txt', data: '' },
          ]),
        ),
      ),
    ).toEqual([])
    expect(codes(readPackZip(buildRawZip([{ name: 'a/readme.md', data: '' }])))).toEqual([])
  })

  it('a zip with a trailing comment is read', () => {
    const z = readPackZip(buildRawZip([ok], { comment: 'made by someone' }))
    expect(codes(z)).toEqual([])
    expect(paths(z)).toEqual(['pixelsky-extension.json'])
  })

  it('stored (method 0) entries and empty files read back', () => {
    const z = readPackZip(
      buildRawZip([
        ok,
        { name: 's.txt', data: 'stored', method: 0 },
        { name: 'e.txt', data: '', method: 0 },
        { name: 'e8.txt', data: '' },
      ]),
    )
    expect(codes(z)).toEqual([])
    expect(dec.decode(z.read('s.txt', 100)!)).toBe('stored')
    expect(z.read('e.txt', 100)!.length).toBe(0)
    expect(z.read('e8.txt', 100)!.length).toBe(0)
  })

  it('read honours maxBytes and unknown paths return null', () => {
    const z = readPackZip(buildRawZip([ok, { name: 'a.txt', data: 'abcdef' }]))
    expect(dec.decode(z.read('a.txt', 3)!)).toBe('abc')
    expect(z.read('nope', 10)).toBeNull()
    expect(z.stat('nope')).toBeNull()
  })
})
