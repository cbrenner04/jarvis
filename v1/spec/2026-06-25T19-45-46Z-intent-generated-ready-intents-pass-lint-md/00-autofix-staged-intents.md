# Autofix staged intents to pass lint:md

## Problem

`jarvis intent` fan-out writes ready-intents under `v1/spec/.../ready-intents/`,
inside the `.markdownlint-cli2.jsonc` lint globs. Emitted files trip active
default rules (`MD012` consecutive blank lines after an appended empty
`## Prerequisites`, `MD018` missing ATX space on a wrapped `#499`). The
post-generation `bun run ready` then fails at `lint:md`, the draft PR is never
auto-readied, and the operator hand-fixes the markdown.

The emit-contract repair (`repairIntentStageContent` → `repairIntentFile` in
`v1/src/commands/intent.ts`) already normalizes `name:` frontmatter and appends
`## Prerequisites`, then `validateIntentStageContent` gates. Extend that repair
so emitted files are also `lint:md`-clean before validation.

## Decisions

- Fix via `markdownlint-cli2 --fix` autofix on staged intent files, not hand-rolled per-rule string edits — autofix shares lint:md's engine+config so it cannot drift; bespoke MD012/MD018 fixes rot when a new default rule trips.
- Run autofix after the structural `name:`/`## Prerequisites` repair and before `validateIntentStageContent` — structural repair appends `## Prerequisites`, which can itself introduce the blank-line/spacing violations autofix must then clean.
- Drive autofix with the same `.markdownlint-cli2.jsonc` config lint:md uses, resolved from the harness repo and passed explicitly — cwd-based config discovery yields a different/empty rule set on the external no-commit staging path, reintroducing drift.
- Place autofix in the shared repair step so it applies on both commit and no-commit staging with no path-specific branch.
- Scope is autofixable rules only (covers the observed MD012/MD018); non-autofixable violations stay out of scope — emit prompt + structural repair + validation already constrain shape.
- Do not change the ready tier: `lint:md` stays authoritative, same step, same position.

## Task checklist

- Add a markdownlint autofix pass to the emit-contract repair in `v1/src/commands/intent.ts`, after structural repair and before validation, on the staged markdown files.
- Resolve and pass the harness `.markdownlint-cli2.jsonc` config so autofix uses lint:md's rule set.
- Add a test driving fan-out output containing MD012 and MD018 violations and asserting the emitted files are lint-clean.
- Confirm existing repair tests still pass.

## Acceptance criteria

- [ ] After `jarvis intent` fan-out, running `bun run lint:md` over the generated `ready-intents/*.md` tree exits 0 with no operator edits, including inputs that would otherwise trip `MD012` and `MD018`.
- [ ] The emit-contract repair applies markdownlint autofix to staged intent files after the `name:`/`## Prerequisites` repair and before `validateIntentStageContent`.
- [ ] Autofix uses the same markdownlint config the `lint:md` ready step uses — no separate or relaxed rule set.
- [ ] A new test in `v1/test/intent-command.sandbox-unrunnable.test.ts` drives fan-out producing `MD012` (consecutive blank lines) and `MD018` (missing ATX space) input and asserts the emitted files are lint-clean.
- [ ] The existing repair cases in `v1/test/intent-command.sandbox-unrunnable.test.ts` (name and `## Prerequisites` repair) stay green — structural repair behavior unchanged.
- [ ] `lint:md` remains a step in the full ready tier in its existing position in `scripts/ready.ts` — not relaxed or reordered.

## Documentation updates

- `v1/docs/intent-mode.md`: extend the emit-contract repair description (the "harness-enforced with deterministic repair" paragraph) to note staged intents are autofixed to `lint:md`-clean before validation.
- `v2/docs/v1-behaviors.md`: update the intent fan-out / emit-contract repair entry to record that emitted ready-intents are markdownlint-autofixed against lint:md's config before validation.
