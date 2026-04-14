# Api-Geno

API client generator (OpenAPI → TypeScript) with Zod validation and neverthrow result handling.

## ✨ Key Features

- **DRY Code Generation**: Default values (like `application/json` content-type) are omitted from generated code to keep service files clean and readable.
- **Atomic Request Helper**: The generated `request-helper.ts` is modular and split into atomic utility functions (`buildUrl`, `validateData`, `serializeBody`, `getHeaders`), making the logic easier to audit and reuse.
- **Consistent Structure**: Uses a sophisticated `CodeBuilder` to ensure consistent formatting, import management, and object generation across all files.
- **Type-Safe Results**: Uses `neverthrow` for robust, functional error handling instead of try/catch blocks.
- **Runtime Validation**: Automatic Zod schema generation and validation for all request and response data.
- **Flexible Adapters**: Supports both `axios` and `fetch` with binary response support.

## 🚀 Future Roadmap

This project already works and passes all tests. The following are high-impact next features you can add:

1. **Customizable HTTP adapter plugins**
   - support `axios`, `fetch`, or custom adapter functions in generated clients
   - provide lightweight middleware hooks for retries, telemetry, request/response interceptors

2. **Retry/backoff policy**
   - add configurable retry behavior (`retries`, `backoff`, `retryOn`) in adapter
   - support 429 + 5XX + network errors with exponential backoff

3. **OpenAPI security scheme generation**
   - generate code for bearer, API key, basic auth, OAuth2 keepers in `OpenAPI` config
   - enable automatic auth header injection and token refresh hooks

4. **CLI output formats**
   - support flags like `--flat`, `--split-services`, `--no-zod`
   - include `--target` (ESM/CJS) and `--no-namespace` options

5. **Schema coverage report**
   - run after generation to report total endpoints, missing/untouched schemas
   - output Markdown/JSON report for QA and auditing

6. **Service alias facade**
   - generate top-level `api.<tag>.<operation>()` shortcuts for convenience
   - keep existing `services` folder layout for compatibility

7. **Validation strictness modes**
   - `strict` | `warn` | `none` for runtime zod checks in `request` helper
   - optional `skipErrors` mode for lenient APIs

8. **Post-generation formatting**
   - optionally run `prettier --write` / `eslint --fix` after generation
   - add `--format` flag to CLI to control this behavior

9. **Plugin extension API**
   - richer plugin API for schema transformations, paths, and annotations
   - support `beforeGenerate`, `afterGenerate`, `transformEndpoint`, `transformSchema` on hooks

## 🧪 Run tests

```bash
bun install
bun test
```

## 🔧 Build + generate

```bash
bun run build
bun run ./dist/cli.js generate -i api.json -o ./generated --force
```
