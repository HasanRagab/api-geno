import { test, expect } from 'bun:test'
import fs from 'fs'
import path from 'path'
import { parseOpenAPI } from '../src/parser/openapi'

test('parseOpenAPI supports all specs under test/specs', () => {
  const specsDir = path.join(process.cwd(), 'test', 'specs')
  const files = fs.readdirSync(specsDir).filter((file) => file.endsWith('.json'))

  expect(files.length).toBeGreaterThan(0)

  files.forEach((file) => {
    const specPath = path.join(specsDir, file)
    expect(() => parseOpenAPI(specPath)).not.toThrow()

    const parsed = parseOpenAPI(specPath)
    expect(parsed).toHaveProperty('endpoints')
    expect(parsed).toHaveProperty('schemas')
  })
})
