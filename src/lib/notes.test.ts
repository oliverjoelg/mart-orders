import { describe, expect, it } from 'vitest'
import { notesForRound } from './notes'
import type { Note } from './types'

const note = (id: string, buyer_id: string | null, item_id: string | null): Note => ({
  id, buyer_id, item_id, body: id, is_flag: true, resolved: false, created_by: null, created_at: '2026-11-26T00:00:00Z',
})

describe('notesForRound', () => {
  const notes = [
    note('item-here', 'b1', 'i1'),
    note('item-other-round', 'b1', 'i9'),
    note('student-here', 'b1', null),
    note('student-not-here', 'b9', null),
  ]

  it('keeps notes on this round’s items and on students ordering in it', () => {
    expect(notesForRound(notes, ['i1'], ['b1']).map((n) => n.id)).toEqual(['item-here', 'student-here'])
  })

  it('drops everything when the round has no orders', () => {
    expect(notesForRound(notes, [], [])).toEqual([])
  })
})
