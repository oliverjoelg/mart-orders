import { describe, expect, it } from 'vitest'
import { formatBytes, yearsLeft } from './Usage'

const MB = 1024 * 1024

describe('usage page maths', () => {
  it('formats sizes for people', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(3.4 * MB)).toBe('3.4 MB')
    expect(formatBytes(140 * MB)).toBe('140 MB')
  })
  it('estimates years until the 500 MB database is full from our growth so far', () => {
    // 10 MB used, 5 MB of it ours, gathered over one year -> 490 MB left at 5 MB a year = 98 years
    const y = yearsLeft({ db_bytes: 10 * MB, public_bytes: 5 * MB, first_round_at: '2026-01-01T00:00:00Z', measured_at: '2027-01-01T00:00:00Z' })
    expect(y).toBeCloseTo(98, 0)
  })
  it('has no estimate before the first round', () => {
    expect(yearsLeft({ db_bytes: 10 * MB, public_bytes: 0, first_round_at: null, measured_at: '2027-01-01T00:00:00Z' })).toBeNull()
  })
})
