import { describe, expect, it } from 'vitest'
import { decide, groupCandidates, isReadable, langsFor, normaliseName, rank, scoreName } from './match'

const item = (id: string, print_name: string | null, size = 'M', product_id = 'p-navy') => ({ id, product_id, size, print_name })

describe('langsFor', () => {
  it('always reads English, and adds each Indian script that appears', () => {
    expect(langsFor(['RAHUL', null])).toEqual(['eng'])
    expect(langsFor(['राहुल', 'தமிழ்', 'ASHA', 'ಕನ್ನಡ']).sort()).toEqual(['eng', 'hin', 'kan', 'tam'])
  })
})

describe('normaliseName / isReadable', () => {
  it('keeps letters, marks and digits only', () => {
    expect(normaliseName(' Mr. Rahul_07 ★ ')).toBe('MRRAHUL07')
    expect(normaliseName('राहुल!')).toBe('राहुल')
  })
  it('emoji-only and one-letter names are not readable', () => {
    expect(isReadable('🔥🔥')).toBe(false)
    expect(isReadable('A')).toBe(false)
    expect(isReadable('A 🔥 B')).toBe(true)
  })
})

describe('scoreName', () => {
  it('finds the name inside a noisy read', () => {
    expect(scoreName('MDI\nRAHUL\nPG26', 'Rahul')).toBeGreaterThan(0.95)
  })
  it('tolerates a misread letter', () => {
    expect(scoreName('SHRE3', 'SHREE')).toBeCloseTo(0.8, 5)
    expect(scoreName('राहूल', 'राहुल')).toBeGreaterThanOrEqual(0.75)
  })
  it('is low for an unrelated name', () => {
    expect(scoreName('KAVYA', 'ARJUN')).toBeLessThan(0.3)
  })
})

describe('groupCandidates', () => {
  it('treats identical shirts as one candidate and skips unreadable names', () => {
    const c = groupCandidates([item('1', 'RAHUL'), item('2', 'rahul'), item('3', 'RAHUL', 'L'), item('4', '🔥'), item('5', null)])
    expect(c).toHaveLength(2)
    expect(c.find((x) => x.size === 'M')!.itemIds).toEqual(['1', '2'])
  })
})

describe('decide', () => {
  const cands = groupCandidates([item('1', 'RAHUL'), item('2', 'RAHUL', 'XL'), item('3', 'ROHIT'), item('4', 'KAVYA'), item('5', 'राहुल', 'S')])

  it('ticks on its own when one name clearly wins', () => {
    const d = decide(rank('KAVYA', cands))
    expect(d.kind).toBe('match')
    if (d.kind === 'match') expect(d.best.candidate.name).toBe('KAVYA')
  })
  it('reads Hindi too', () => {
    const d = decide(rank('राहुल', cands))
    expect(d.kind).toBe('match')
    if (d.kind === 'match') expect(d.best.candidate.size).toBe('S')
  })
  it('asks which size when the same name exists in two sizes', () => {
    const d = decide(rank('RAHUL', cands))
    expect(d.kind).toBe('choose')
    if (d.kind === 'choose') expect(d.options.map((o) => o.candidate.size).sort()).toEqual(['M', 'XL'])
  })
  it('asks a person when two different names are close', () => {
    // a fold hides the last two letters: ROHAN or ROHIT?
    const d = decide(rank('ROH~~', groupCandidates([item('1', 'ROHAN'), item('2', 'ROHIT')])))
    expect(d.kind).toBe('choose')
    if (d.kind === 'choose') expect(d.options.map((o) => o.candidate.name).sort()).toEqual(['ROHAN', 'ROHIT'])
  })
  it('gives up on a read that matches nothing', () => {
    expect(decide(rank('ZZZZQ', cands)).kind).toBe('none')
  })
})
