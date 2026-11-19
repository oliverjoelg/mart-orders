import Papa from 'papaparse'

export interface Sheet {
  name: string
  /** first row = headers; every cell as text */
  rows: string[][]
}

export const ACCEPTED_FILES = '.csv,.xlsx,.xls,.ods,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/vnd.oasis.opendocument.spreadsheet'

export function isSpreadsheetName(name: string): boolean {
  return /\.(csv|xlsx|xls|ods)$/i.test(name)
}

/**
 * Reads a CSV or Excel-type file (xlsx, xls, ods) into sheets of text rows, entirely in the
 * browser. Dates come out as "yyyy-mm-dd hh:mm:ss" so the importer reads them as India time.
 */
export async function readSpreadsheet(file: File): Promise<Sheet[]> {
  if (/\.csv$/i.test(file.name)) {
    const text = (await file.text()).replace(/^﻿/, '')
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: false })
    return [{ name: file.name, rows: parsed.data.map((r) => r.map((c) => String(c ?? ''))) }]
  }
  const XLSX = await import('xlsx')
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true })
  return wb.SheetNames.map((name) => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
      header: 1,
      raw: false,
      dateNF: 'yyyy-mm-dd hh:mm:ss',
      defval: '',
      blankrows: true,
    })
    return { name, rows: rows.map((r) => r.map((c) => String(c ?? ''))) }
  }).filter((s) => s.rows.some((r) => r.some((c) => c.trim())))
}

/** Writes sheets to an .xlsx file and downloads it (used for the sample file). */
export async function downloadXlsx(fileName: string, sheets: Sheet[]) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows)
    ws['!cols'] = (s.rows[0] ?? []).map((h) => ({ wch: Math.min(Math.max(String(h).length, 12), 45) }))
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31))
  }
  XLSX.writeFile(wb, fileName)
}
