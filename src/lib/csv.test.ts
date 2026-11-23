import { describe, expect, it } from 'vitest'
import { toCsv } from './csv'

describe('toCsv', () => {
  it('neutralises cells that Excel would run as formulas', () => {
    const csv = toCsv([['name'], ['=HYPERLINK("http://x","y")'], ['+91 98'], ['@cmd'], ['RAHUL']])
    expect(csv).toContain(`"'=HYPERLINK(""http://x"",""y"")"`)
    expect(csv).toContain(`'+91 98`)
    expect(csv).toContain(`'@cmd`)
    expect(csv.trimEnd().endsWith('\nRAHUL')).toBe(true)
  })
})
