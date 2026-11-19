/**
 * Optional local check against a real Google Form export. Skipped unless MART_REAL_CSV points
 * at a CSV file outside the repo. Prints counts only, never names, emails or phone numbers.
 *
 *   MART_REAL_CSV="C:/path/to/responses.csv" npx vitest run src/lib/import/realFile.test.ts
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseFormCsv } from './parseForm'
import { TEST_PRODUCTS } from './__fixtures__/fakeForm'

const path = process.env.MART_REAL_CSV

describe.skipIf(!path)('real form export (local only)', () => {
  it('parses to the form total', () => {
    const preview = parseFormCsv(readFileSync(path!, 'utf8'), TEST_PRODUCTS)
    const issues: Record<string, number> = {}
    for (const i of preview.items) for (const c of i.issues) issues[c] = (issues[c] ?? 0) + 1
    const byProduct: Record<string, number> = {}
    for (const i of preview.items) byProduct[i.product_id ?? '?'] = (byProduct[i.product_id ?? '?'] ?? 0) + 1
    const mismatchRows = preview.responses.filter((r) => r.declared_total !== null && r.declared_total !== r.shirts)
    console.log({
      fatal: preview.fatal,
      stats: preview.stats,
      issues,
      byProduct,
      buyers: preview.buyers.length,
      mismatches: mismatchRows.map((r) => ({ row: r.row, declared: r.declared_total, parsed: r.shirts })),
    })
    expect(preview.fatal).toEqual([])
  })
})
