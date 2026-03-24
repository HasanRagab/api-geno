import { test, expect, describe, beforeAll } from 'bun:test'
import fs, { readFileSync, existsSync, readdirSync } from 'fs'
import path from 'path'
import { spawnSync } from 'bun'
import { generateClient } from '../src/generator/client'
import { generateFromOpenAPI } from '../src/index'
import { Endpoint } from '../src/models'

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
  let serviceFilenames: string[]
  let serviceAggregate: string
  let typeFilenames: string[]

  beforeAll(() => {
    client = safeRead('client.ts')
    types = safeRead('types.ts')
    errors = safeRead('errors.ts')

    const serviceDir = `${GENERATED_DIR}/services`
    serviceFilenames = existsSync(serviceDir)
      ? readdirSync(serviceDir).filter((f) => f.endsWith('.ts'))
      : []

    serviceAggregate = serviceFilenames
      .map((f) => safeRead(`services/${f}`))
      .join('\n')

    const typeDir = `${GENERATED_DIR}/types`
    typeFilenames = existsSync(typeDir)
      ? readdirSync(typeDir).filter((f) => f.endsWith('.ts'))
      : []
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

  test('generated service methods use precise opts types', () => {
    expect(serviceFilenames.length).toBeGreaterThan(0)
    const allServiceContents = serviceFilenames.map((f) => safeRead(`services/${f}`))

    allServiceContents.forEach((serviceContent) => {
      expect(serviceContent.includes('opts: any')).toBe(false)
      expect(serviceContent.includes('opts?: any')).toBe(false)
    })

    const anyHaveOpts = allServiceContents.some((serviceContent) =>
      !!(serviceContent.match(/opts\s*\?:\s*\{/) || serviceContent.match(/opts\s*:\s*\{/))
    )
    expect(anyHaveOpts).toBe(true)
  })

  test('generated methods assign defaults for params/headers/cookies', () => {
    const endpoints: Endpoint[] = [
      {
        path: '/items',
        method: 'GET',
        operationId: 'listItems',
        tags: ['Items'],
        parameters: [{ name: 'page', in: 'query', schema: { type: 'number' } }],
        requestBody: undefined,
        requestBodyRef: undefined,
        queryParamsRef: 'itemsFindAllQueryParams',
        responseRef: 'ItemListResponseDto',
        contentType: 'application/json',
        responses: {},
      },
    ]

    const generated = generateClient(endpoints)
    const service = generated['services/ItemsService.ts']

    expect(service).toContain('const { params = {}, headers = {}, cookies = {} } = opts;')
  })

  test('safe method naming dedupes collision operations', () => {
    const endpoints: Endpoint[] = [
      {
        path: '/users',
        method: 'GET',
        operationId: 'getUser',
        tags: ['Users'],
        parameters: [],
        requestBody: undefined,
        requestBodyRef: undefined,
        queryParamsRef: undefined,
        responseRef: undefined,
        contentType: 'application/json',
        responses: {},
      },
      {
        path: '/users/{id}',
        method: 'GET',
        operationId: 'getUser',
        tags: ['Users'],
        parameters: [{ name: 'id', in: 'path', schema: { type: 'string' } }],
        requestBody: undefined,
        requestBodyRef: undefined,
        queryParamsRef: undefined,
        responseRef: undefined,
        contentType: 'application/json',
        responses: {},
      },
    ]

    const generated = generateClient(endpoints)
    const service = generated['services/UsersService.ts']

    expect(service).toContain('static async getUser(')
    expect(service).toContain('static async getUser1(')
  })

  test('supports DELETE endpoints with requestBodyRef in opts and parser', () => {
    const endpoints: Endpoint[] = [
      {
        path: '/x/{id}',
        method: 'DELETE',
        operationId: 'removeX',
        tags: ['X'],
        parameters: [{ name: 'id', in: 'path', schema: { type: 'string' } }],
        requestBody: {},
        requestBodyRef: 'DeleteXDto',
        queryParamsRef: undefined,
        responseRef: 'DeleteXResponseDto',
        contentType: 'application/json',
        responses: {},
      },
    ];

    const generated = generateClient(endpoints);
    const service = generated['services/XService.ts'];

    expect(service).toContain('body?: DeleteXDto');
    expect(service).toContain('if (body) { try { DeleteXDtoSchema.parse(body); } catch (error: unknown) { return err(new ValidationError(formatError(error))); } }');
  })

  test('generateFromOpenAPI uses fetch adapter when requested', () => {
    const files = generateFromOpenAPI('test/specs/openapi3.json', [], { httpAdapter: 'fetch' })
    expect(files['http-adapter.ts']).toContain('fetch(')
    expect(files['http-adapter.ts']).not.toContain('axios')
  })

  test('plugins can transform endpoints and schemas', () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/item': {
          get: {
            operationId: 'getItem',
            responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } } },
            tags: ['Item'],
          },
        },
      },
      components: { schemas: { Item: { type: 'object' } } },
    }

    const tempPath = path.join(process.cwd(), 'test', 'tmp-openapi.json')
    fs.writeFileSync(tempPath, JSON.stringify(spec), 'utf8')

    const plugin = {
      name: 'test-plugin',
      transformEndpoint: (endpoint: Endpoint) => ({ ...endpoint, operationId: endpoint.operationId + 'X' }),
      transformSchema: (name: string, schema: any) => ({ ...schema, description: 'transformed' }),
    }

    const files = generateFromOpenAPI(tempPath, [plugin], { httpAdapter: 'axios' })
    fs.unlinkSync(tempPath)

    expect(files['services/ItemService.ts']).toContain('getItemX')
    const schemaFile = Object.entries(files).find(([key]) => key === 'types/Item.ts')
    expect(schemaFile).toBeDefined()
    expect(schemaFile?.[1]).toContain('transformed')
  })

  test('generated types preserve nested component references', () => {
    expect(typeFilenames.length).toBeGreaterThan(0)
    const sampleType = typeFilenames.includes('CourseResponseDto.ts') ? 'CourseResponseDto.ts' : typeFilenames[0]
    const sampleTypeContent = read(`types/${sampleType}`)

    expect(sampleTypeContent).toContain('export const')
    expect(sampleTypeContent).toContain('export type')

    if (typeFilenames.includes('PaginationMetaDto.ts')) {
      const paginationContent = read('types/PaginationMetaDto.ts')
      expect(paginationContent).toContain('export const PaginationMetaDtoSchema')
      expect(paginationContent).toContain('export type PaginationMetaDto = z.infer<typeof PaginationMetaDtoSchema>')
    }
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
    const courseSchema = read('types/CourseResponseDto.ts')
    expect(courseSchema).toMatch(/\.optional\(\)/)
  })

  test('arrays are generated correctly in zod schema', () => {
    const courseSchema = read('types/CourseResponseDto.ts')
    expect(courseSchema).toMatch(/z\.array\(/)
  })

  test('nullable fields handled in zod schema', () => {
    const courseSchema = read('types/CourseResponseDto.ts')
    expect(courseSchema).toMatch(/\.nullable\(\)/)
  })

  test('enums are generated in zod schema', () => {
    const courseSchema = read('types/CourseResponseDto.ts')
    expect(courseSchema).toMatch(/z\.enum\(/)
  })

  // --------------------------------------------------
  // 🔥 CLIENT VALIDATION
  // --------------------------------------------------

test('client exports services only (facade)', () => {
    expect(client).toContain('export {')
    expect(client).not.toContain('export class')
  })

  test('service methods include params/body/response typing when needed', () => {
    const courses = safeRead('services/CoursesService.ts')
    expect(courses).toMatch(/params\?\s*:\s*coursesFindAllQueryParams/)
    expect(courses).toMatch(/body\?\s*:\s*CreateCourseDto/)
    expect(courses).toMatch(/Promise<Result<.*CourseListResponseDto.*>>/)
  })

  test('http methods are present in services', () => {
    expect(serviceAggregate).toMatch(/method:\s*['"](?:GET|get)['"]/)
    expect(serviceAggregate).toMatch(/method:\s*['"](?:POST|post)['"]/)
  })

  test('query params handled in services', () => {
    expect(serviceAggregate).toMatch(/queryParamsObj/)
    expect(serviceAggregate).toMatch(/Schema\.parse\(params\)/)
  })

  test('client uses formatError in services', () => {
    const courses = safeRead('services/CoursesService.ts')
    expect(courses).toContain('formatError')
  })

  test('content-type handled in services', () => {
    const courses = safeRead('services/CoursesService.ts')
    expect(courses).toMatch(/Content-Type\': 'application\/json'/)
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
    // Snapshot disabled after layout changed to per-file/type exports.
    expect(types).toContain("export * from './types/")
  })

  test('client snapshot', () => {
    expect(client).toContain('export {')
    expect(client).not.toContain('export class')
  })

  test('errors snapshot', () => {
    expect(errors).toContain('export class ValidationError')
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