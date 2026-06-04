import { randomUUID } from 'node:crypto'
import * as XLSX from 'xlsx'

export const MAX_DATASET_BYTES = 10 * 1024 * 1024
export const SUPPORTED_DATASET_FORMATS = ['json', 'jsonl', 'csv', 'xlsx'] as const

export type EvalDatasetFileFormat = (typeof SUPPORTED_DATASET_FORMATS)[number]

export type FreeFormRow = Record<string, unknown> & { id: string }

export interface ParsedEvalDataset {
  records: FreeFormRow[]
  rows: FreeFormRow[]
}

export const DATASET_CONTENT_TYPES: Record<EvalDatasetFileFormat, string> = {
  json: 'application/json',
  jsonl: 'application/x-ndjson',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

const ID_KEY = 'id'
const MAX_CELL_LENGTH = 100_000

export function getDatasetFileFormat(fileName: string): EvalDatasetFileFormat | null {
  const extension = fileName.split('.').pop()?.toLowerCase()
  return SUPPORTED_DATASET_FORMATS.find((format) => format === extension) ?? null
}

export function validateDatasetBytes(
  format: EvalDatasetFileFormat,
  bytes: ArrayBuffer
): { ok: true; parsed: ParsedEvalDataset } | { ok: false; error: string } {
  const parsed = parseDatasetBytes(format, bytes)
  if (!parsed.ok) return parsed

  for (let index = 0; index < parsed.parsed.records.length; index += 1) {
    const validation = validateFreeFormRow(parsed.parsed.records[index], parsed.parsed.records, index)
    if (!validation.ok) {
      return {
        ok: false,
        error: `Invalid eval case ${index + 1}: ${validation.error}`,
      }
    }
  }

  return parsed
}

export function parseDatasetBytes(
  format: EvalDatasetFileFormat,
  bytes: ArrayBuffer
): { ok: true; parsed: ParsedEvalDataset } | { ok: false; error: string } {
  if (format === 'xlsx') {
    return parseXlsxDataset(bytes)
  }

  const text = new TextDecoder().decode(bytes)
  if (format === 'json') return parseJsonDataset(text)
  if (format === 'jsonl') return parseJsonlDataset(text)
  return parseCsvDataset(text)
}

export function freeFormRowsToRecords(
  rows: FreeFormRow[]
): { ok: true; records: FreeFormRow[] } | { ok: false; error: string } {
  const seen = new Set<string>()
  const records: FreeFormRow[] = []

  for (let index = 0; index < rows.length; index += 1) {
    const row = normalizeFreeFormRow(rows[index])
    const rowNumber = index + 1

    if (typeof row.id !== 'string' || !row.id.trim()) {
      return { ok: false, error: `Row ${rowNumber}: id is required.` }
    }
    const id = row.id.trim()
    if (seen.has(id)) {
      return { ok: false, error: `Row ${rowNumber}: duplicate id "${id}".` }
    }
    seen.add(id)

    records.push(row)
  }

  return { ok: true, records }
}

export function newFreeFormRow(): FreeFormRow {
  return { id: randomUUID() }
}

export function serializeDataset(
  format: EvalDatasetFileFormat,
  records: FreeFormRow[]
): Uint8Array {
  if (format === 'json') {
    return new TextEncoder().encode(`${JSON.stringify(records, null, 2)}\n`)
  }
  if (format === 'jsonl') {
    return new TextEncoder().encode(`${records.map((record) => JSON.stringify(record)).join('\n')}\n`)
  }
  if (format === 'csv') {
    return new TextEncoder().encode(serializeCsv(records))
  }

  const worksheet = XLSX.utils.json_to_sheet(records)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Dataset')
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
}

function parseJsonDataset(
  text: string
): { ok: true; parsed: ParsedEvalDataset } | { ok: false; error: string } {
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch (error) {
    return {
      ok: false,
      error: `Invalid JSON dataset: ${error instanceof SyntaxError ? error.message : 'parse failed'}`,
    }
  }

  let records: unknown[]
  if (Array.isArray(payload)) {
    records = payload
  } else if (isRecord(payload) && 'cases' in payload) {
    if (!Array.isArray(payload.cases)) {
      return { ok: false, error: 'Invalid JSON dataset: cases must be a list.' }
    }
    records = payload.cases
  } else if (isRecord(payload)) {
    records = [payload]
  } else {
    return {
      ok: false,
      error: 'Invalid JSON dataset: expected a case, a list of cases, or an object with cases.',
    }
  }

  return recordsToParsedDataset(records)
}

function parseJsonlDataset(
  text: string
): { ok: true; parsed: ParsedEvalDataset } | { ok: false; error: string } {
  const records: unknown[] = []
  const lines = text.split(/\r?\n/)

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const line = lines[lineNumber].trim()
    if (!line) continue

    try {
      records.push(JSON.parse(line))
    } catch (error) {
      return {
        ok: false,
        error: `Invalid JSONL record on line ${lineNumber + 1}: ${error instanceof SyntaxError ? error.message : 'parse failed'}`,
      }
    }
  }

  return recordsToParsedDataset(records)
}

function parseCsvDataset(
  text: string
): { ok: true; parsed: ParsedEvalDataset } | { ok: false; error: string } {
  const parsedRows = parseCsv(text)
  if (!parsedRows.ok) return parsedRows
  if (parsedRows.rows.length === 0) return recordsToParsedDataset([])

  const [headers, ...dataRows] = parsedRows.rows
  if (!headers.includes(ID_KEY)) {
    return { ok: false, error: 'CSV dataset must include an "id" column.' }
  }

  const rows = dataRows
    .filter((values) => values.some((value) => value.trim()))
    .map((values) => {
      const record: Record<string, unknown> = {}
      headers.forEach((header, index) => {
        record[header] = decodeCsvCell(values[index] ?? '')
      })
      return record
    })

  return recordsToParsedDataset(rows)
}

function parseXlsxDataset(
  bytes: ArrayBuffer
): { ok: true; parsed: ParsedEvalDataset } | { ok: false; error: string } {
  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(bytes, { type: 'array' })
  } catch (error) {
    return {
      ok: false,
      error: `Invalid XLSX dataset: ${error instanceof Error ? error.message : 'parse failed'}`,
    }
  }

  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) return { ok: false, error: 'XLSX dataset must contain at least one worksheet.' }

  const worksheet = workbook.Sheets[firstSheetName]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: '',
  })

  return recordsToParsedDataset(rows)
}

function recordsToParsedDataset(
  records: unknown[]
): { ok: true; parsed: ParsedEvalDataset } | { ok: false; error: string } {
  if (!records.every(isRecord)) {
    return { ok: false, error: 'Invalid eval dataset: every case must be an object.' }
  }

  return { ok: true, parsed: { records: records as FreeFormRow[], rows: records as FreeFormRow[] } }
}

function normalizeFreeFormRow(value: FreeFormRow): FreeFormRow {
  const out: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(value)) {
    out[key] = sanitizeValue(raw)
  }
  return out as FreeFormRow
}

function sanitizeValue(value: unknown): unknown {
  if (value === undefined) return null
  if (value === null) return null
  if (typeof value === 'string') {
    return value.length > MAX_CELL_LENGTH ? value.slice(0, MAX_CELL_LENGTH) : value
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(sanitizeValue)
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeValue(v)
    }
    return out
  }
  if (typeof value === 'bigint') return value.toString()
  return null
}

function validateFreeFormRow(
  value: unknown,
  allRows: FreeFormRow[],
  index: number
): { ok: true } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: 'case must be an object.' }
  if (typeof value.id !== 'string' || !value.id.trim()) {
    return { ok: false, error: 'id is required and must be a non-empty string.' }
  }
  const id = value.id.trim()
  for (let i = 0; i < allRows.length; i += 1) {
    if (i === index) continue
    if (typeof allRows[i].id === 'string' && allRows[i].id.trim() === id) {
      return { ok: false, error: `duplicate id "${id}".` }
    }
  }
  return { ok: true }
}

function parseCsv(text: string): { ok: true; rows: string[][] } | { ok: false; error: string } {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const nextChar = text[index + 1]

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        cell += '"'
        index += 1
      } else if (char === '"') {
        inQuotes = false
      } else {
        cell += char
      }
      continue
    }

    if (char === '"') {
      if (cell.length > 0) return { ok: false, error: 'Invalid CSV dataset: unexpected quote.' }
      inQuotes = true
    } else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (char !== '\r') {
      cell += char
    }
  }

  if (inQuotes) return { ok: false, error: 'Invalid CSV dataset: unterminated quoted field.' }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  return { ok: true, rows }
}

function decodeCsvCell(raw: string): unknown {
  const trimmed = raw.trim()
  if (trimmed === '') return ''
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
    trimmed === 'null' ||
    trimmed === 'true' ||
    trimmed === 'false' ||
    /^-?\d+(\.\d+)?$/.test(trimmed)
  ) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return raw
    }
  }
  return raw
}

function serializeCsv(rows: FreeFormRow[]): string {
  const headers = collectHeaders(rows)
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((row) => headers.map((header) => escapeCsvCell(encodeCsvCell(row[header]))).join(',')),
  ]
  return `${lines.join('\n')}\n`
}

function collectHeaders(rows: FreeFormRow[]): string[] {
  const seen = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (key !== ID_KEY) seen.add(key)
    }
  }
  return [ID_KEY, ...Array.from(seen).sort()]
}

function encodeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function escapeCsvCell(value: string): string {
  if (!/[",\n\r]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
