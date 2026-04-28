# 🧹 API-geno DRY Refactor TODO (Checklist)

## 🔴 Critical (must fix first)

### ☑ 1. Create shared `RequestOpts` type

* [x] Move repeated `opts` shape into one global type
* [x] Remove per-method inline `{ params?, body?, headers?, cookies? }`

```ts
RequestOpts<P, B, Q>
```

---

### ☑ 2. Stop repeating destructuring in every method

* [x] Remove:

  * `const { params, body, headers, cookies } = opts || {}`
* [x] Replace with:

  * Conditional header/cookie spreading in request call

---

### ☑ 3. Centralize request building logic in `BaseService`

* [x] Add helper:

  * `request<T>(options: RequestOpts)`
* [x] Handle:

  * pathParams
  * headers defaults (conditional spreading)
  * cookies defaults (conditional spreading)

---

### ☑ 4. Remove all `queryParams = {}`

* [x] Only generate query handling when schema exists
* [x] Otherwise omit (undefined instead of empty object)

---

### ☑ 5. Eliminate all `any` in generated services

* [x] Replace:

  * `any` → `unknown` in RequestOpts, request function, helpers
* [x] Response types default to `unknown` instead of `any`

---

## 🟠 High Priority (structure DRY)

### ⏸ 6. Introduce method factory pattern (optional but powerful)

* [ ] Move repetitive request calls into:

  * `createMethod(config)`
* [ ] Reduce all methods to declarative configs
* *Deferred: major refactor, big benefit not critical right now*

---

### ⏸ 7. Standardize schema imports per domain

* [ ] Replace scattered imports:

  * `CreateAssignmentBodySchema`
* [ ] With grouped imports:

  * `AssignmentSchemas.Create`
* *Deferred: requires schema grouping in types generation*

---

### ☑ 8. Remove duplicated headers/cookies defaults

* [x] Conditional spreading in request call
* [x] Stop repeating:

  * `headers = {}, cookies = {}` in every method

---

### ☑ 9. Ensure params are strictly typed (no optional unsafe params)

* [x] Change:

  * `params?: { id: string }`
* [x] To:

  * `params: { id: string }` (when required)

---

## 🟡 Medium Priority (clean architecture)

### ☑ 10. Normalize import structure

* [x] Order imports:

  * external libs (`neverthrow`)
  * internal core (`BaseService`)
  * errors
  * types
  * schemas

---

### ⏸ 11. Deduplicate shared types

* [ ] Move reusable types to:

  * `/shared/types`
* [ ] Avoid redefining pagination, base responses, etc.
* *Deferred: requires tracking type usage across generation*

---

### ☑ 12. Enforce schema-driven generation

* [x] Every mutation MUST have:

  * bodySchema OR warn during generation
* [x] Every path param validation via strict typing

---

## 🟢 Nice to Have (advanced DRY)

### ⏸ 13. Optional declarative service generator

* [ ] Replace full classes with:

```ts
createService({
  basePath,
  methods: [...]
})
```
* *Nice to have: reduces boilerplate further*

---

### ⏸ 14. Add unused import pruning pass

* [ ] Auto-remove unused:

  * types
  * schemas
  * helpers
* *Nice to have: improves cleanliness*

---

### ⏸ 15. Optional SDK mode split

* [ ] strict mode → no any, full validation
* [ ] loose mode → unknown fallback
* [ ] frontend mode → React Query hooks
* *Nice to have: advanced mode system*

---

# 💡 Final Summary

## ✅ Completed (9/15)

✔ RequestOpts centralization
✔ remove repeated destructuring
✔ BaseService request builder
✔ remove queryParams noise
✔ eliminate `any`
✔ Remove headers/cookies defaults
✔ Strict param typing
✔ Normalize imports
✔ Enforce schema-driven generation

## ⏸ Deferred (6/15)

- Factory pattern (big refactor, good follow-up)
- Schema import grouping (type system changes)
- Shared types deduplication (cross-generation tracking)
- Declarative service generator (advanced optimization)
- Import pruning (nice-to-have polish)
- SDK mode split (advanced feature)

---