---
name: code-review
description: >
  Deep code analysis skill. Use this whenever the user wants to review, audit, or improve their
  codebase — even if they just say "look at my code", "what's wrong here", "can you improve this",
  "refactor this", or "any suggestions?". Triggers on any request involving reading source files
  with intent to improve them. Works with any language or framework. Produces annotated code with
  inline comments explaining every finding, plus a structured summary. Always use this skill when
  the user shares code files and wants feedback, improvements, or a second opinion.
---

# Code Review Skill

Perform a thorough, language-agnostic code review. Analyze logic, patterns, and architecture.
Output annotated code with inline comments, followed by a structured summary.

---

## Step 1 — Gather the Code

Determine scope from the user's request:

| What they said | What to do |
|---|---|
| Specific files named | Read only those files |
| "my codebase" / no file specified | Run `find . -type f` to list files, then read all source files (skip lock files, build artifacts, `.git/`) |
| A code snippet pasted inline | Work directly from the snippet |

Read every relevant file before forming opinions. Do not skim.

---

## Step 2 — Analyse Thoroughly

For each file (or the whole codebase together), examine:

### 2a. Redundancy & Inefficiency
- Duplicate logic that could be extracted into shared functions/modules
- Unnecessary loops, repeated DB/API calls, avoidable re-computation
- Dead code (unreachable branches, unused variables/imports/exports)
- Over-engineered abstractions for simple problems

### 2b. Refactoring Opportunities
- Functions/methods doing more than one thing (Single Responsibility)
- Long functions that should be decomposed
- Magic numbers/strings that should be named constants
- Inconsistent naming conventions within the same codebase
- Deeply nested logic that can be flattened (early returns, guard clauses)
- Repeated patterns that suggest a missing abstraction (class, utility, hook, etc.)

### 2c. Architecture & Design
- Tight coupling between modules that should be independent
- Missing or violated separation of concerns
- State management issues (global mutation, side effects in unexpected places)
- Dependency direction violations (e.g. lower layers importing from higher layers)
- Scalability concerns (will this break at 10× current load/data size?)

### 2d. Potential Bugs & Edge Cases
- Off-by-one errors, boundary conditions not handled
- Missing null/undefined/empty checks
- Error handling gaps (unhandled promise rejections, swallowed exceptions)
- Race conditions or concurrency issues
- Type mismatches or implicit coercions

### 2e. Feature & Enhancement Opportunities
- Common patterns in the domain that are missing (pagination, caching, retry logic, rate limiting)
- Logging/observability gaps
- Configuration values hardcoded that should be environment-driven
- Tests that are missing for critical paths
- UX or API design improvements if applicable

---

## Step 3 — Produce Annotated Output

For each reviewed file, output the **full file content** with inline comments added. Use the comment syntax of the file's language.

### Comment tagging convention

Prefix every inserted comment with a tag so findings are easy to scan:

| Tag | Meaning |
|---|---|
| `[REDUNDANT]` | Duplicate or dead code |
| `[REFACTOR]` | Structure/readability improvement |
| `[BUG]` | Likely or definite defect |
| `[PERF]` | Performance concern |
| `[ARCH]` | Architectural / design issue |
| `[FEATURE]` | Missing capability worth adding |
| `[STYLE]` | Naming, formatting, convention |

### Comment format

```
// [TAG] Short title
// Explanation: what the problem is, why it matters, and the concrete fix.
// Fix: <one-line or code snippet showing the improvement>
```

Place comments **directly above** the line or block they refer to. Do not restructure the code itself — annotations only.

Example (Python):

```python
# [REFACTOR] Extract magic number to named constant
# Explanation: The value 86400 appears 3 times with no label. A reader has no idea it means
# "seconds in a day" without context. Named constants make intent explicit and prevent drift.
# Fix: SECONDS_PER_DAY = 86_400  (define once at module level)
seconds = timestamp / 86400
```

---

## Step 4 — Write the Summary

After all annotated files, append a **Review Summary** section:

```
## Review Summary

### Stats
- Files reviewed: N
- Total findings: N  (🔴 critical · 🟡 moderate · 🟢 minor)

### Top Priorities
1. [BUG] <title> — <one-sentence why it's urgent>
2. [ARCH] <title> — ...
3. ...  (list up to 5)

### Patterns to Address
Describe any cross-cutting themes (e.g. "Error handling is consistently absent across all
async functions", "Naming is inconsistent between camelCase and snake_case").

### Quick Wins
Improvements that are low-effort / high-value (e.g. "Replace all magic numbers with constants —
30 min, touches 4 files").

### Suggested Next Steps
Ordered list of what to tackle first, with rough effort estimates.
```

---

## Behaviour Guidelines

- **Never silently skip** a finding because it feels minor. Tag it `[STYLE]` and include it.
- **Always explain the fix**, not just the problem. "This is bad" is not useful. "Replace X with Y because Z" is.
- **Be language-aware**: apply idiomatic standards for the language in use (Pythonic style, JS best practices, etc.) even though the skill is language-agnostic.
- **Don't rewrite the code** in the annotation pass. The user should be able to apply changes themselves. If a larger rewrite is warranted, describe it in the summary under "Suggested Next Steps".
- **For very large codebases** (>20 files): summarise findings by module in Step 4, and offer to drill into specific modules in follow-up turns.