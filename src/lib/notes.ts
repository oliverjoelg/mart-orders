import type { Note } from './types'

/**
 * The notes that belong to the round being shown.
 * - A note on an item shows only in that item's round.
 * - A note on a student (no item) follows the student into every round they order in,
 *   because students are shared across rounds (one record per roll number).
 * Everything else (other rounds' items, students with no order here) is left out.
 */
export function notesForRound(notes: Note[], itemIds: Iterable<string>, buyerIds: Iterable<string>): Note[] {
  const items = new Set(itemIds)
  const buyers = new Set(buyerIds)
  return notes.filter((n) => (n.item_id ? items.has(n.item_id) : n.buyer_id !== null && buyers.has(n.buyer_id)))
}
