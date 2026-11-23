import Papa from 'papaparse'

/**
 * Downloads rows as a CSV that Excel opens with the right encoding. Built in the browser; nothing is uploaded.
 * Cells starting with = + - @ get a leading ' so a student-typed "name" can't run as an Excel formula.
 */
export function toCsv(rows: (string | number | null)[][]): string {
  return '﻿' + Papa.unparse(rows, { escapeFormulae: true })
}

export function downloadCsv(fileName: string, rows: (string | number | null)[][]) {
  const csv = toCsv(rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    // older phones / non-secure context: fall back to a hidden textarea
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  ta.remove()
}

export function fileStamp(): string {
  return new Date().toISOString().slice(0, 10)
}
