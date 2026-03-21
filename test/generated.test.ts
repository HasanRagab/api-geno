import { test, expect, describe, beforeAll } from 'bun:test'
import { readFileSync, existsSync } from 'fs'
import { spawnSync } from 'bun'

const GENERATED_DIR = './generated'

function read(file: string) {
  return readFileSync(`${GENERATED_DIR}/${file}`, 'utf8')
}

function safeRead(file: string) {
  if (!existsSync(`${GENERATED_DIR}/${file}`)) {
    throw new Error(`${file} was not generated`)
  }
  return read(file)
}

describe('generated code', () => {
  let client: string
  let types: string
  let errors: string

  beforeAll(() => {
    client = safeRead('client.ts')
    types = safeRead('types.ts')
    errors = safeRead('errors.ts')
  })

  // --------------------------------------------------
  // ✅ YOUR ORIGINAL TESTS (kept + slightly hardened)
  // --------------------------------------------------

  test('generated errors contains formatError and ValidationError', () => {
    const hasClass = errors.includes('export class ValidationError')
    const hasShape = errors.includes('export interface ValidationErrorShape')

    expect(hasClass || hasShape).toBe(true)
    expect(errors).toContain('export function formatError')
  })

  test('generated client methods use precise opts types', () => {
    expect(client.includes('opts: any')).toBe(false)
    expect(client.includes('opts?: any')).toBe(false)

    expect(
      client.match(/opts\s*\?:\s*\{/) ||
      client.match(/opts\s*:\s*\{/)
    ).toBeTruthy()
  })

  test('generated types preserve nested component references', () => {
    expect(types).toContain('export const CourseResponseDtoSchema')
    expect(types).toContain('export type CourseResponseDto = z.infer<typeof CourseResponseDtoSchema>')
    expect(types).toContain('export const PaginationMetaDtoSchema')
    expect(types).toContain('export type PaginationMetaDto = z.infer<typeof PaginationMetaDtoSchema>')
  })

  // --------------------------------------------------
  // 🔥 COMPILATION SAFETY
  // --------------------------------------------------

  test('generated code compiles', () => {
    const result = spawnSync(['bunx', 'tsc', '--noEmit'], {
      cwd: GENERATED_DIR,
    })

    if (result.exitCode !== 0) {
      console.error(result.stderr?.toString())
    }

    expect(result.exitCode).toBe(0)
  })

  // --------------------------------------------------
  // 🔥 TYPE SAFETY
  // --------------------------------------------------

  test('no any leaks in client', () => {
    expect(client.includes(': any')).toBe(false)
  })

  test('$ref are resolved', () => {
    expect(types.includes('#/components/schemas')).toBe(false)
  })

  test('integer does not leak to output', () => {
    expect(types).not.toContain('integer')
  })

  // --------------------------------------------------
  // 🔥 STRUCTURE TESTS
  // --------------------------------------------------

  test('optional fields are marked correctly in zod schema', () => {
    expect(types).toMatch(/\.optional\(\)/)
  })

  test('arrays are generated correctly in zod schema', () => {
    expect(types).toMatch(/z\.array\(/)
  })

  test('nullable fields handled in zod schema', () => {
    expect(types).toMatch(/\.nullable\(\)/)
  })

  test('enums are generated in zod schema', () => {
    expect(types).toMatch(/z\.enum\(/)
  })

  // --------------------------------------------------
  // 🔥 CLIENT VALIDATION
  // --------------------------------------------------

  test('client includes params, body, and response typing', () => {
    expect(client).toMatch(/params\??:\s*\{/)
    expect(client).toMatch(/body\??:\s*/)
    expect(client).toMatch(/Promise<.*>/)
  })

  test('http methods are present', () => {
    expect(client).toMatch(/method:\s*['"]GET['"]/)
    expect(client).toMatch(/method:\s*['"]POST['"]/)
  })

  test('query params handled', () => {
    expect(client).toMatch(/query|searchParams/)
  })

  test('client uses formatError', () => {
    expect(client).toContain('formatError')
  })

  test('content-type handled', () => {
    expect(client).toMatch(/application\/json|multipart\/form-data/)
  })

  // --------------------------------------------------
  // 🔥 STABILITY TESTS
  // --------------------------------------------------

  test('types are not duplicated', () => {
    const matches = types.match(/export (interface|type) \w+/g) || []
    const unique = new Set(matches)

    expect(matches.length).toBe(unique.size)
  })

  test('no undefined leaks', () => {
    expect(types).not.toContain('undefined;')
  })

  // --------------------------------------------------
  // 🔥 SNAPSHOTS (regression protection)
  // --------------------------------------------------

  test('types snapshot', () => {
    expect(types).toMatchSnapshot()
  })

  test('client snapshot', () => {
    expect(client).toMatchSnapshot()
  })

  test('errors snapshot', () => {
    expect(errors).toMatchSnapshot()
  })

  // --------------------------------------------------
  // 🔥 RUNTIME VALIDATION
  // --------------------------------------------------

  test('generated client is importable', async () => {
    const mod = await import('../generated/client.ts')

    expect(mod).toBeDefined()
    expect(typeof mod).toBe('object')
  })
})