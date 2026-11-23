/**
 * Scan mode's matcher. The camera's OCR text is messy (a wrong letter, stray marks, a fold),
 * but we always know the full list of back names still to arrive, so we never need a perfect
 * read: we only pick the closest name on that list, and ask a person when two are close.
 * Pure functions, no camera or OCR here.
 */

/** Unicode blocks of the scripts we expect on shirts, and the Tesseract language that reads each. */
const SCRIPTS: { lang: string; from: number; to: number }[] = [
  { lang: 'hin', from: 0x0900, to: 0x097f }, // Devanagari (Hindi, Marathi, Sanskrit…)
  { lang: 'ben', from: 0x0980, to: 0x09ff }, // Bengali, Assamese
  { lang: 'pan', from: 0x0a00, to: 0x0a7f }, // Gurmukhi
  { lang: 'guj', from: 0x0a80, to: 0x0aff },
  { lang: 'ori', from: 0x0b00, to: 0x0b7f },
  { lang: 'tam', from: 0x0b80, to: 0x0bff },
  { lang: 'tel', from: 0x0c00, to: 0x0c7f },
  { lang: 'kan', from: 0x0c80, to: 0x0cff },
  { lang: 'mal', from: 0x0d00, to: 0x0d7f },
  { lang: 'ara', from: 0x0600, to: 0x06ff }, // Arabic script (Urdu too)
]

/** Tesseract languages needed for these names: English always, plus every other script that appears. */
export function langsFor(names: (string | null)[]): string[] {
  const langs = new Set(['eng'])
  for (const n of names) {
    for (const ch of n ?? '') {
      const cp = ch.codePointAt(0)!
      const s = SCRIPTS.find((x) => cp >= x.from && cp <= x.to)
      if (s) langs.add(s.lang)
    }
  }
  return [...langs]
}

/** What OCR can be compared on: letters, combining marks and digits only, upper-case. */
export function normaliseName(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^\p{L}\p{M}\p{N}]/gu, '')
}

/** A name OCR has a chance with: at least 2 letters/digits once symbols and emoji are dropped. */
export function isReadable(name: string | null | undefined): boolean {
  return [...normaliseName(name)].length >= 2
}

function levenshtein(a: string[], b: string[]): number {
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

/** 1 = identical, 0 = nothing in common (by edit distance over characters). */
export function similarity(a: string, b: string): number {
  const x = [...a]
  const y = [...b]
  const len = Math.max(x.length, y.length)
  return len === 0 ? 0 : 1 - levenshtein(x, y) / len
}

/**
 * How well a candidate name fits the OCR text. The name may sit anywhere in the read text, with
 * junk around it (logos, folds), so we slide a window of about the name's length over every line.
 */
export function scoreName(ocrText: string, name: string): number {
  const target = [...normaliseName(name)]
  if (target.length < 2) return 0
  const tgt = target.join('')
  let best = 0
  const lines = [...ocrText.split(/\n+/), ocrText.replace(/\n+/g, ' ')]
  for (const line of lines) {
    const chars = [...normaliseName(line)]
    if (!chars.length) continue
    if (chars.join('').includes(tgt)) {
      // exact name inside the line; slightly less sure if the line is much longer than the name
      best = Math.max(best, 0.92 + 0.08 * (target.length / chars.length))
      continue
    }
    for (const w of [target.length - 1, target.length, target.length + 1]) {
      if (w < 1) continue
      if (chars.length <= w) {
        best = Math.max(best, similarity(chars.join(''), tgt))
        continue
      }
      for (let i = 0; i + w <= chars.length; i++) {
        best = Math.max(best, similarity(chars.slice(i, i + w).join(''), tgt))
      }
    }
  }
  return best
}

export interface Candidate {
  /** shirts that are interchangeable for receiving: same product, size and back name */
  key: string
  name: string
  size: string
  itemIds: string[]
}

/** One candidate per distinct (product, size, back name); identical shirts share a key. */
export function groupCandidates(items: { id: string; product_id: string; size: string; print_name: string | null }[]): Candidate[] {
  const map = new Map<string, Candidate>()
  for (const i of items) {
    if (!isReadable(i.print_name)) continue
    const key = `${i.product_id}|${i.size.toUpperCase()}|${normaliseName(i.print_name)}`
    const c = map.get(key) ?? { key, name: i.print_name!, size: i.size, itemIds: [] }
    c.itemIds.push(i.id)
    map.set(key, c)
  }
  return [...map.values()]
}

export interface Ranked {
  candidate: Candidate
  score: number
}

export type Decision =
  | { kind: 'match'; best: Ranked }
  | { kind: 'choose'; options: Ranked[] }
  | { kind: 'none' }

/** Rank every candidate against the OCR text, best first. */
export function rank(ocrText: string, candidates: Candidate[]): Ranked[] {
  return candidates
    .map((candidate) => ({ candidate, score: scoreName(ocrText, candidate.name) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
}

/**
 * Sure enough to tick on its own? Only when the best is a strong read AND clearly ahead of the
 * next different name. Same name in another size is not "different" for reading purposes, so
 * then a person picks the size. Otherwise offer the top few as big buttons.
 */
export function decide(ranked: Ranked[], { sure = 0.8, gap = 0.15, maybe = 0.5 } = {}): Decision {
  const best = ranked[0]
  if (!best || best.score < maybe) return { kind: 'none' }
  const bestName = normaliseName(best.candidate.name)
  const rival = ranked.find((r) => r !== best && r.score > best.score - gap)
  if (best.score >= sure && !rival) return { kind: 'match', best }
  if (best.score >= sure && rival && normaliseName(rival.candidate.name) === bestName) {
    // same name, different size: show just those
    return { kind: 'choose', options: ranked.filter((r) => normaliseName(r.candidate.name) === bestName).slice(0, 4) }
  }
  return { kind: 'choose', options: ranked.slice(0, 3) }
}
