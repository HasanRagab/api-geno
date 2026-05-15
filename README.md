# api-geno

TypeScript API client generator from OpenAPI specs. Produces typed services with [Zod](https://zod.dev) validation and [neverthrow](https://github.com/supermacro/neverthrow) `Result` returns — no thrown exceptions.

```bash
npx api-geno generate -i openapi.json -o src/api
npx api-geno generate -i https://api.example.com/openapi.json -o src/api
```

---

## Features

- **File or URL input** — pass a local JSON file or a remote spec URL directly
- **Axios or Fetch** — choose your HTTP adapter with `--adapter`
- **Zod validation** — request bodies and query params are validated at runtime (disable with `--no-zod`)
- **neverthrow Results** — every service method returns `Result<T, AppError>` instead of throwing
- **Per-tag services** — endpoints are split into typed service classes by tag (e.g. `UsersService`, `OrdersService`)
- **Smart skip** — hashes inputs + options; skips generation when nothing changed
- **Watch mode** — re-generates on file change, or polls a URL every 5s
- **Format on write** — runs `biome` or `prettier` after writing if available

---

## Installation

```bash
npm install -D api-geno
# or
bun add -D api-geno
```

---

## Quick start

```bash
# From a local file
npx api-geno generate -i openapi.json -o src/api

# From a URL
npx api-geno generate -i https://petstore3.swagger.io/api/v3/openapi.json -o src/api

# Format output and write a coverage report
npx api-geno generate -i openapi.json -o src/api --format --report

# Use fetch instead of axios
npx api-geno generate -i openapi.json -o src/api --adapter fetch

# Watch for changes
npx api-geno generate -i openapi.json -o src/api --watch
```

---

## Generated output

```
src/api/
├── client.ts           # ApiClient — holds all service instances
├── services/
│   ├── UsersService.ts
│   └── OrdersService.ts
├── types.ts            # Zod schemas + inferred TypeScript types
├── errors.ts           # AppError, HttpError, ValidationError
├── http-adapter.ts     # Axios or Fetch implementation
├── openapi.config.ts   # Base URL and auth config
└── request-helper.ts   # BaseService, request pipeline
```

### Using the generated client

```ts
import { ApiClient } from './src/api/client';
import { OpenAPI } from './src/api/openapi.config';

const client = new ApiClient(OpenAPI);

const result = await client.users.getUser({ params: { id: '42' } });

if (result.isOk()) {
  console.log(result.value);
} else {
  console.error(result.error.message);
}
```

### Configuring auth and base URL

Edit `openapi.config.ts` or override at runtime:

```ts
// Static token
OpenAPI.TOKEN = 'my-token';

// Dynamic token (called before every request)
OpenAPI.TOKEN = () => localStorage.getItem('token');

// Update at runtime
client.updateConfig({ BASE: 'https://api.staging.example.com' });
```

---

## CLI reference

```
api-geno generate -i <source> -o <dir> [options]
```

| Flag | Default | Description |
|---|---|---|
| `-i, --input <source>` | — | **Required.** File path or URL to OpenAPI JSON spec |
| `-o, --output <dir>` | — | **Required.** Output directory |
| `--adapter <adapter>` | `axios` | HTTP adapter: `axios` or `fetch` |
| `--error-style <style>` | `both` | Error types: `class`, `shape`, or `both` |
| `--no-zod` | — | Skip Zod schema generation |
| `--no-split-services` | — | Emit one `ApiService` instead of per-tag classes |
| `--flat` | — | Write all files into a single directory (no `services/` subfolder) |
| `--format` | — | Format output with biome or prettier after writing |
| `--report` | — | Write `coverage-report.md` to the output directory |
| `-f, --force` | — | Regenerate even when inputs and options are unchanged |
| `--dry-run` | — | Print generated files to stdout instead of writing them |
| `-w, --watch` | — | Re-generate on file change; poll every 5s for URL inputs |

---

## Config file

Create `api-geno.config.json` in your project root to avoid repeating flags. CLI flags take precedence over config file values.

```json
{
  "input": "openapi.json",
  "output": "src/api",
  "adapter": "fetch",
  "errorStyle": "shape",
  "format": true,
  "report": true
}
```

Then just run:

```bash
npx api-geno generate
```

---

## Error styles

| Style | What's generated |
|---|---|
| `both` (default) | Error classes (`AppError`, `HttpError`, `ValidationError`) + shape interfaces |
| `class` | Error classes only |
| `shape` | Shape interfaces only (useful if you want plain objects, no `instanceof`) |

---

## Programmatic API

```ts
import { generateFromOpenAPI, generateFromOpenAPIContent } from 'api-geno';

// From file
const { files, stats } = generateFromOpenAPI('openapi.json', [], {
  httpAdapter: 'fetch',
  errorStyle: 'shape',
});

// From string (e.g. after fetching a URL yourself)
const { files, stats } = generateFromOpenAPIContent(jsonString, [], {
  httpAdapter: 'axios',
});

// files — Record<string, string> — file path → content
// stats.endpoints, stats.fileCount, stats.durationMs
```

### Plugin API

```ts
import type { GeneratorPlugin } from 'api-geno/plugins/plugin';

const myPlugin: GeneratorPlugin = {
  name: 'my-plugin',
  transformEndpoint(endpoint) {
    return { ...endpoint, operationId: endpoint.operationId.toLowerCase() };
  },
  afterGenerate(files, api) {
    files['index.ts'] = `export * from './client';\n`;
  },
};

generateFromOpenAPI('openapi.json', [myPlugin]);
```

---

## Development

```bash
bun install      # install deps + set up git hooks (lefthook)
bun run build    # compile
bun run test     # run tests
bun run verify   # lint + typecheck + test + build (full CI)
```

Use [changesets](https://github.com/changesets/changesets) to version changes:

```bash
bun run changeset
```
