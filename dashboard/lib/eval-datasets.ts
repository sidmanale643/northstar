import * as XLSX from 'xlsx'

export const MAX_DATASET_BYTES = 10 * 1024 * 1024
export const SUPPORTED_DATASET_FORMATS = ['json', 'jsonl', 'csv', 'xlsx'] as const

export type EvalDatasetFileFormat = (typeof SUPPORTED_DATASET_FORMATS)[number]

export interface EvalDatasetTableRow {
  id: string
  input: string
  messages: string
  expected: string
  metrics: string
  metadata: string
}

export interface ParsedEvalDataset {
  records: Record<string, unknown>[]
  rows: EvalDatasetTableRow[]
}

export const DATASET_CONTENT_TYPES: Record<EvalDatasetFileFormat, string> = {
  json: 'application/json',
  jsonl: 'application/x-ndjson',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

const CASE_KEYS = new Set(['id', 'input', 'messages', 'expected', 'metrics', 'metadata'])
const EXPECTED_KEYS = new Set([
  'goal',
  'ground_truth',
  'context',
  'rubric',
  'required_tools',
  'forbidden_tools',
  'tool_sequence',
  'contains',
  'not_contains',
  'tool_arguments',
  'require_tool_output_reference',
  'max_tool_calls',
  'max_latency_ms',
  'max_cost_usd',
])
const TOOL_ARGUMENT_KEYS = new Set(['name', 'arguments'])
const METRIC_KEYS = new Set(['latency_ms', 'cost_usd'])
const TABLE_COLUMNS = ['id', 'input', 'messages', 'expected', 'metrics', 'metadata'] as const
type ColumnKey = (typeof TABLE_COLUMNS)[number]

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
    const validation = validateCase(parsed.parsed.records[index])
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

export function tableRowsToRecords(
  rows: EvalDatasetTableRow[]
): { ok: true; records: Record<string, unknown>[] } | { ok: false; error: string } {
  const records: Record<string, unknown>[] = []

  for (let index = 0; index < rows.length; index += 1) {
    const row = normalizeTableRow(rows[index])
    const rowNumber = index + 1
    const record: Record<string, unknown> = {}

    if (!row.id.trim()) return { ok: false, error: `Row ${rowNumber}: id is required.` }
    record.id = row.id.trim()

    if (row.input.trim()) record.input = row.input

    const messages = parseJsonCell(row.messages, `Row ${rowNumber}: messages`)
    if (!messages.ok) return messages
    record.messages = messages.value

    const expected = parseOptionalJsonCell(row.expected, `Row ${rowNumber}: expected`)
    if (!expected.ok) return expected
    if (expected.value !== undefined) record.expected = expected.value

    const metrics = parseOptionalJsonCell(row.metrics, `Row ${rowNumber}: metrics`)
    if (!metrics.ok) return metrics
    if (metrics.value !== undefined) record.metrics = metrics.value

    const metadata = parseOptionalJsonCell(row.metadata, `Row ${rowNumber}: metadata`)
    if (!metadata.ok) return metadata
    if (metadata.value !== undefined) record.metadata = metadata.value

    const validation = validateCase(record)
    if (!validation.ok) {
      return { ok: false, error: `Row ${rowNumber}: ${validation.error}` }
    }

    records.push(record)
  }

  return { ok: true, records }
}

export function recordsToTableRows(records: Record<string, unknown>[]): EvalDatasetTableRow[] {
  return records.map((record) => ({
    id: typeof record.id === 'string' ? record.id : '',
    input: typeof record.input === 'string' ? record.input : '',
    messages: formatJsonCell(record.messages, []),
    expected: formatJsonCell(record.expected, {}),
    metrics: formatJsonCell(record.metrics, {}),
    metadata: formatJsonCell(record.metadata, {}),
  }))
}

export function serializeDataset(
  format: EvalDatasetFileFormat,
  records: Record<string, unknown>[]
): Uint8Array {
  if (format === 'json') {
    return new TextEncoder().encode(`${JSON.stringify(records, null, 2)}\n`)
  }
  if (format === 'jsonl') {
    return new TextEncoder().encode(`${records.map((record) => JSON.stringify(record)).join('\n')}\n`)
  }
  if (format === 'csv') {
    return new TextEncoder().encode(serializeCsv(recordsToTableRows(records)))
  }

  const worksheet = XLSX.utils.json_to_sheet(recordsToTableRows(records), {
    header: [...TABLE_COLUMNS],
  })
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
  const missingHeader = TABLE_COLUMNS.find((column) => !headers.includes(column))
  if (missingHeader) {
    return { ok: false, error: `CSV dataset is missing "${missingHeader}" column.` }
  }

  const rows = dataRows
    .filter((values) => values.some((value) => value.trim()))
    .map((values) => normalizeTableRow(Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? ''])
    )))

  return tableRowsToParsedDataset(rows)
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
  }).map(normalizeTableRow)

  const firstRow = rows[0]
  if (!firstRow) return tableRowsToParsedDataset([])

  return tableRowsToParsedDataset(rows)
}

function tableRowsToParsedDataset(
  rows: EvalDatasetTableRow[]
): { ok: true; parsed: ParsedEvalDataset } | { ok: false; error: string } {
  const records = tableRowsToRecords(rows)
  if (!records.ok) return records
  return { ok: true, parsed: { records: records.records, rows: recordsToTableRows(records.records) } }
}

function recordsToParsedDataset(
  records: unknown[]
): { ok: true; parsed: ParsedEvalDataset } | { ok: false; error: string } {
  if (!records.every(isRecord)) {
    return { ok: false, error: 'Invalid eval dataset: every case must be an object.' }
  }

  return {
    ok: true,
    parsed: {
      records,
      rows: recordsToTableRows(records),
    },
  }
}

function parseJsonCell(
  value: string,
  label: string
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (!value.trim()) return { ok: false, error: `${label} is required.` }
  try {
    return { ok: true, value: JSON.parse(value) }
  } catch (error) {
    return {
      ok: false,
      error: `${label} must be valid JSON: ${error instanceof SyntaxError ? error.message : 'parse failed'}`,
    }
  }
}

function parseOptionalJsonCell(
  value: string,
  label: string
): { ok: true; value: unknown | undefined } | { ok: false; error: string } {
  if (!value.trim()) return { ok: true, value: undefined }
  const parsed = parseJsonCell(value, label)
  return parsed.ok ? { ok: true, value: parsed.value } : parsed
}

function formatJsonCell(value: unknown, fallback: unknown) {
  return JSON.stringify(value === undefined || value === null ? fallback : value, null, 2)
}

function normalizeTableRow(value: Partial<Record<ColumnKey, unknown>>): EvalDatasetTableRow {
  return {
    id: cellToString(value.id),
    input: cellToString(value.input),
    messages: cellToString(value.messages),
    expected: cellToString(value.expected),
    metrics: cellToString(value.metrics),
    metadata: cellToString(value.metadata),
  }
}

function cellToString(value: unknown) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

function serializeCsv(rows: EvalDatasetTableRow[]) {
  const lines = [
    TABLE_COLUMNS.map(escapeCsvCell).join(','),
    ...rows.map((row) => TABLE_COLUMNS.map((column) => escapeCsvCell(row[column])).join(',')),
  ]
  return `${lines.join('\n')}\n`
}

function escapeCsvCell(value: string) {
  if (!/[",\n\r]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
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

function validateCase(value: unknown): { ok: true } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: 'case must be an object.' }

  const extraCaseKey = firstExtraKey(value, CASE_KEYS)
  if (extraCaseKey) return { ok: false, error: `unexpected field "${extraCaseKey}".` }
  if (typeof value.id !== 'string') return { ok: false, error: 'id must be a string.' }
  if ('input' in value && !optionalString(value.input)) {
    return { ok: false, error: 'input must be a string.' }
  }
  if (!Array.isArray(value.messages) || !value.messages.every(isRecord)) {
    return { ok: false, error: 'messages must be a list of objects.' }
  }
  if ('expected' in value && !validateExpected(value.expected)) {
    return { ok: false, error: 'expected has invalid fields.' }
  }
  if ('metrics' in value && !validateMetrics(value.metrics)) {
    return { ok: false, error: 'metrics has invalid fields.' }
  }
  if ('metadata' in value && !isRecord(value.metadata)) {
    return { ok: false, error: 'metadata must be an object.' }
  }

  return { ok: true }
}

function validateExpected(value: unknown) {
  if (!isRecord(value)) return false
  if (firstExtraKey(value, EXPECTED_KEYS)) return false

  return (
    optionalString(value.goal) &&
    optionalString(value.ground_truth) &&
    optionalStringList(value.context) &&
    optionalString(value.rubric) &&
    optionalStringList(value.required_tools) &&
    optionalStringList(value.forbidden_tools) &&
    optionalStringList(value.tool_sequence) &&
    optionalStringList(value.contains) &&
    optionalStringList(value.not_contains) &&
    optionalToolArguments(value.tool_arguments) &&
    optionalBoolean(value.require_tool_output_reference) &&
    optionalNonNegativeInteger(value.max_tool_calls) &&
    optionalNonNegativeNumber(value.max_latency_ms) &&
    optionalNonNegativeNumber(value.max_cost_usd)
  )
}

function validateMetrics(value: unknown) {
  if (!isRecord(value)) return false
  if (firstExtraKey(value, METRIC_KEYS)) return false

  return optionalNumber(value.latency_ms) && optionalNumber(value.cost_usd)
}

function optionalToolArguments(value: unknown) {
  if (value === undefined || value === null) return true
  if (!Array.isArray(value)) return false

  return value.every((entry) => {
    if (!isRecord(entry)) return false
    if (firstExtraKey(entry, TOOL_ARGUMENT_KEYS)) return false
    return typeof entry.name === 'string' && isRecord(entry.arguments)
  })
}

function optionalString(value: unknown) {
  return value === undefined || value === null || typeof value === 'string'
}

function optionalStringList(value: unknown) {
  if (value === undefined || value === null || typeof value === 'string') return true
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function optionalNonNegativeInteger(value: unknown) {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'number' && Number.isInteger(value) && value >= 0)
  )
}

function optionalNonNegativeNumber(value: unknown) {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'number' && Number.isFinite(value) && value >= 0)
  )
}

function optionalNumber(value: unknown) {
  return value === undefined || value === null || (typeof value === 'number' && Number.isFinite(value))
}

function optionalBoolean(value: unknown) {
  return value === undefined || value === null || typeof value === 'boolean'
}

function firstExtraKey(value: Record<string, unknown>, allowedKeys: Set<string>) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) return key
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
