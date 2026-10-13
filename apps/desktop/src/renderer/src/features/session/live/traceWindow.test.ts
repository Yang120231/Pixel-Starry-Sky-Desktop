import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WINDOW_PREFS,
  clampDockWidth,
  clampFloat,
  fitsFloat,
  fromFractions,
  loadWindowPrefs,
  parseWindowPrefs,
  resizeRect,
  saveWindowPrefs,
  toFractions,
} from './traceWindow'

const box = { w: 1000, h: 700 }

describe('clampDockWidth', () => {
  it('keeps 320 to 90% of the container', () => {
    expect(clampDockWidth(560, 1000)).toBe(560)
    expect(clampDockWidth(100, 1000)).toBe(320)
    expect(clampDockWidth(2000, 1000)).toBe(900)
  })
  it('gives way when the container is narrower than the minimum', () => {
    expect(clampDockWidth(560, 300)).toBe(270)
  })
  it('falls back for NaN', () => {
    expect(clampDockWidth(Number.NaN, 1000)).toBe(560)
  })
})

describe('clampFloat', () => {
  it('leaves a rect inside the container alone', () => {
    const r = { x: 100, y: 50, w: 400, h: 300 }
    expect(clampFloat(r, box, 44)).toEqual(r)
  })
  it('moves a rect back inside, header fully visible', () => {
    expect(clampFloat({ x: -50, y: -20, w: 400, h: 300 }, box, 44)).toMatchObject({ x: 0, y: 0 })
    expect(clampFloat({ x: 900, y: 650, w: 400, h: 300 }, box, 44)).toMatchObject({ x: 600, y: 400 })
  })
  it('enforces the minimum size', () => {
    expect(clampFloat({ x: 0, y: 0, w: 50, h: 50 }, box, 44)).toMatchObject({ w: 320, h: 240 })
  })
  it('shrinks when the container shrinks', () => {
    expect(clampFloat({ x: 300, y: 100, w: 700, h: 600 }, { w: 500, h: 400 }, 44)).toEqual({
      x: 0,
      y: 0,
      w: 500,
      h: 400,
    })
    const tiny = clampFloat({ x: 0, y: 0, w: 400, h: 300 }, { w: 200, h: 150 }, 44)
    expect(tiny).toMatchObject({ w: 200, h: 150 })
  })
})

describe('resizeRect', () => {
  const start = { x: 200, y: 100, w: 400, h: 300 }
  it('moves the dragged edge and keeps the opposite one', () => {
    expect(resizeRect(start, 'e', 100, 0, box)).toEqual({ x: 200, y: 100, w: 500, h: 300 })
    expect(resizeRect(start, 'w', -100, 0, box)).toEqual({ x: 100, y: 100, w: 500, h: 300 })
    expect(resizeRect(start, 'nw', -50, -40, box)).toEqual({ x: 150, y: 60, w: 450, h: 340 })
  })
  it('stops at the minimum size without pushing the other edge', () => {
    expect(resizeRect(start, 'w', 500, 0, box)).toEqual({ x: 280, y: 100, w: 320, h: 300 })
    expect(resizeRect(start, 'n', 0, 500, box)).toEqual({ x: 200, y: 160, w: 400, h: 240 })
  })
  it('stops at the container edge', () => {
    expect(resizeRect(start, 'se', 900, 900, box)).toEqual({ x: 200, y: 100, w: 800, h: 600 })
    expect(resizeRect(start, 'nw', -900, -900, box)).toEqual({ x: 0, y: 0, w: 600, h: 400 })
  })
})

describe('fractions', () => {
  it('round-trips within a pixel', () => {
    const r = { x: 123, y: 45, w: 456, h: 321 }
    const back = fromFractions(toFractions(r, box), box)
    expect(back).toEqual(r)
  })
  it('keeps a similar place in another size', () => {
    const f = toFractions({ x: 500, y: 70, w: 400, h: 350 }, box)
    expect(fromFractions(f, { w: 2000, h: 1400 })).toEqual({ x: 1000, y: 140, w: 800, h: 700 })
  })
  it('does not divide by zero', () => {
    expect(toFractions({ x: 1, y: 1, w: 1, h: 1 }, { w: 0, h: 0 })).toEqual(DEFAULT_WINDOW_PREFS.float)
  })
})

describe('fitsFloat', () => {
  it('needs the minimum size', () => {
    expect(fitsFloat(box)).toBe(true)
    expect(fitsFloat({ w: 320, h: 240 })).toBe(true)
    expect(fitsFloat({ w: 319, h: 700 })).toBe(false)
    expect(fitsFloat({ w: 1000, h: 239 })).toBe(false)
  })
})

describe('storage', () => {
  const memory = (initial?: string) => {
    let value = initial ?? null
    return {
      getItem: () => value,
      setItem: (_: string, v: string) => {
        value = v
      },
    }
  }
  it('uses defaults for nothing and for corrupt data', () => {
    expect(parseWindowPrefs(null)).toEqual(DEFAULT_WINDOW_PREFS)
    expect(parseWindowPrefs('{nope')).toEqual(DEFAULT_WINDOW_PREFS)
    expect(parseWindowPrefs('null')).toEqual(DEFAULT_WINDOW_PREFS)
    expect(parseWindowPrefs(JSON.stringify({ ...DEFAULT_WINDOW_PREFS, version: 2 }))).toEqual(DEFAULT_WINDOW_PREFS)
    expect(parseWindowPrefs(JSON.stringify({ ...DEFAULT_WINDOW_PREFS, mode: 'tiled' }))).toEqual(DEFAULT_WINDOW_PREFS)
    expect(parseWindowPrefs(JSON.stringify({ ...DEFAULT_WINDOW_PREFS, dockWidth: 'wide' }))).toEqual(
      DEFAULT_WINDOW_PREFS,
    )
    expect(parseWindowPrefs(JSON.stringify({ ...DEFAULT_WINDOW_PREFS, float: { x: 0, y: 0, w: 5, h: 0.5 } }))).toEqual(
      DEFAULT_WINDOW_PREFS,
    )
  })
  it('round-trips saved prefs', () => {
    const storage = memory()
    const prefs = { ...DEFAULT_WINDOW_PREFS, mode: 'float' as const, dockWidth: 640 }
    saveWindowPrefs(prefs, 'k', storage)
    expect(loadWindowPrefs('k', storage)).toEqual(prefs)
  })
  it('survives a storage that throws', () => {
    const bad = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(loadWindowPrefs('k', bad)).toEqual(DEFAULT_WINDOW_PREFS)
    expect(() => saveWindowPrefs(DEFAULT_WINDOW_PREFS, 'k', bad)).not.toThrow()
  })
})
