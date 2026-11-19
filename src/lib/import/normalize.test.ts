import { describe, expect, it } from 'vitest'
import {
  compareSizes,
  detectDateOrder,
  matchProduct,
  normaliseBatch,
  normalisePrintName,
  normaliseRoll,
  normaliseSize,
  parseFormTimestamp,
} from './normalize'
import { TEST_PRODUCTS } from './__fixtures__/fakeForm'

describe('normaliseSize', () => {
  it.each([
    ['M', 'M'],
    [' m ', 'M'],
    ['XXS (Only for Navy Blue/ Baby Pink)', 'XXS'],
    ['XXS (Only for Blue/Pink)', 'XXS'],
    ['2XL', 'XXL'],
    ['Large', 'L'],
    ['XXXS', 'XXXS'],
  ])('%s -> %s', (raw, want) => {
    expect(normaliseSize(raw)).toEqual({ size: want, custom: false })
  })

  it('keeps unknown sizes as custom', () => {
    expect(normaliseSize('Chest - 38 and Length - 27.5 / 28')).toEqual({
      size: 'Chest - 38 and Length - 27.5 / 28',
      custom: true,
    })
  })

  it('returns null for empty', () => {
    expect(normaliseSize('  ')).toBeNull()
  })

  it('sorts sizes small to large, custom last', () => {
    expect(['XL', 'custom', 'S', 'XXS', 'M'].sort(compareSizes)).toEqual(['XXS', 'S', 'M', 'XL', 'custom'])
  })
})

describe('matchProduct', () => {
  it.each([
    ['Classic MDI Batch T-Shirt Navy Blue (Rs 699/-)', 'p-navy'],
    ['Classic MDI Batch T-Shirt Blue (Rs 699/-)', 'p-navy'],
    ['Classic MDI Batch T-Shirt Baby Pink (Rs 699/-)', 'p-pink'],
    ['Classic MDI Batch T-Shirt Pink (Rs 699/-)', 'p-pink'],
    ['Premium UCB Batch T-Shirt Black (Rs 1049/-)', 'p-black'],
    ['premium ucb white', 'p-white'],
  ])('%s', (raw, id) => {
    expect(matchProduct(raw, TEST_PRODUCTS)?.id).toBe(id)
  })

  it('returns null for no match or an ambiguous answer', () => {
    expect(matchProduct('Green', TEST_PRODUCTS)).toBeNull()
    expect(matchProduct('Black and White', TEST_PRODUCTS)).toBeNull()
    expect(matchProduct('', TEST_PRODUCTS)).toBeNull()
  })
})

describe('small normalisers', () => {
  it('print names', () => {
    expect(normalisePrintName('NA')).toBeNull()
    expect(normalisePrintName(' n/a ')).toBeNull()
    expect(normalisePrintName('-')).toBeNull()
    expect(normalisePrintName('  Dr.  ADITI ')).toBe('Dr. ADITI')
  })
  it('roll numbers', () => {
    expect(normaliseRoll(' pgp26 001 ')).toBe('PGP26001')
  })
  it('batches', () => {
    expect(normaliseBatch('pg’26')).toBe("PG'26")
    expect(normaliseBatch('')).toBeNull()
  })
})

describe('timestamps', () => {
  it('detects D/M/Y vs M/D/Y from the whole file', () => {
    expect(detectDateOrder(['04/09/2026 10:00', '13/09/2026 10:00'])).toBe('dmy')
    expect(detectDateOrder(['9/4/2026 10:00', '9/13/2026 10:00'])).toBe('mdy')
  })
  it('parses the common formats as India time', () => {
    expect(parseFormTimestamp('2026-09-04 20:22:09.559', 'dmy')).toBe('2026-09-04T20:22:09+05:30')
    expect(parseFormTimestamp('04/09/2026 20:22:09', 'dmy')).toBe('2026-09-04T20:22:09+05:30')
    expect(parseFormTimestamp('9/4/2026 8:22:09 PM', 'mdy')).toBe('2026-09-04T20:22:09+05:30')
    expect(parseFormTimestamp('junk', 'dmy')).toBeNull()
  })
})
