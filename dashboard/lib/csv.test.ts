import test from 'node:test'
import assert from 'node:assert/strict'
import { toCsv } from './csv'

test('toCsv returns empty string for empty input', () => {
  assert.equal(toCsv([]), '')
})

test('toCsv emits header row and one data row for single record', () => {
  const out = toCsv([{ a: 1, b: 'x' }])
  assert.equal(out, 'a,b\n1,x')
})

test('toCsv quotes fields with commas', () => {
  const out = toCsv([{ a: 'hello, world' }])
  assert.equal(out, 'a\n"hello, world"')
})

test('toCsv escapes embedded quotes by doubling them', () => {
  const out = toCsv([{ a: 'she said "hi"' }])
  assert.equal(out, 'a\n"she said ""hi"""')
})

test('toCsv quotes fields with newlines', () => {
  const out = toCsv([{ a: 'line1\nline2' }])
  assert.equal(out, 'a\n"line1\nline2"')
})

test('toCsv emits empty string for null and undefined', () => {
  const out = toCsv([{ a: null, b: undefined }])
  assert.equal(out, 'a,b\n,')
})

test('toCsv JSON-stringifies objects', () => {
  const out = toCsv([{ a: { foo: 'bar' } }])
  assert.equal(out, 'a\n"{""foo"":""bar""}"')
})
