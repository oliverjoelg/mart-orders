import { describe, expect, it, vi } from 'vitest'
import { reloadForNewBuild } from './freshBuild'

function memoryStorage() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
}

describe('reloadForNewBuild', () => {
  it('reloads once when a file from an old build is missing', () => {
    const reload = vi.fn()
    expect(reloadForNewBuild(memoryStorage(), 1_000_000, reload)).toBe(true)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('does not loop: a second failure within 30 s does not reload again', () => {
    const s = memoryStorage()
    const reload = vi.fn()
    reloadForNewBuild(s, 1_000_000, reload)
    expect(reloadForNewBuild(s, 1_010_000, reload)).toBe(false)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('reloads again after the next deploy (well past 30 s)', () => {
    const s = memoryStorage()
    const reload = vi.fn()
    reloadForNewBuild(s, 1_000_000, reload)
    expect(reloadForNewBuild(s, 1_000_000 + 3_600_000, reload)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })
})
