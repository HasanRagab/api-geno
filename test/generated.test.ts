import { test, expect } from 'bun:test'
import { readFileSync } from 'fs'

test('generated errors contains formatError and ValidationError', () => {
  const errors = readFileSync('./generated/errors.ts', 'utf8')
  expect(errors).toContain('export class ValidationError')
  expect(errors).toContain('export function formatError')
})

test('generated client methods use precise opts types', () => {
  const client = readFileSync('./generated/client.ts', 'utf8')
  // ensure we didn't leave `opts: any` or `opts?: any`
  expect(client.includes('opts: any')).toBe(false)
  expect(client.includes('opts?: any')).toBe(false)
  // ensure opts param exists with a typed object
  expect(client.match(/opts\s*\?:\s*\{/g) || client.match(/opts\s*:\s*\{/g)).toBeTruthy()
})
