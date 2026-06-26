# Autofix staged intents with the pinned markdownlint-cli2 binary

## Problem

`jarvis intent` fan-out writes ready-intents under `v1/spec/.../ready-intents/`,
inside the `.markdownlint-cli2.jsonc` lint globs. Emitted files trip active
default rules (`MD012` consecutive blank lines after an appended empty
`## Prerequisites`; `MD018` missing ATX space on a line-leading `#NNN`), so the
post-generation `bun run ready` fails at `lint:md` and the operator hand-fixes
the markdown.

A prior attempt (reverted) broke `main`: it shelled out to `npx markdownlint-cli2`
— non-deterministic resolution that passed its own branch gate, then failed 34
`intentCommand` tests on `main` via `MD041`/`MD025`-class flags. It also failed
emit on every residual non-autofixable violation, which pre-empted the
frontmatter/name validation errors existing repair tests assert.

The shared emit-contract repair (`repairIntentStageContent` → `repairIntentFile`
in `v1/src/commands/intent.ts`, run on both the commit path and the no-commit
external path before `validateIntentStageContent` and before the rename into
`ready-intents/`) already normalizes `name:` frontmatter and appends
`## Prerequisites`. Make emitted files `lint:md`-clean deterministically, without
corrupting content and without the residual-failure path that broke `main`.

## Decisions

- Run autofix via the pinned binary `bun node_modules/markdownlint-cli2/markdownlint-cli2.js`, resolved from the harness anchor (`import.meta.dir` up to the repo root), never `npx`. Rules out: npx resolution that passes a branch gate but breaks `intentCommand` on `main`.
- Resolve `.markdownlint-cli2.jsonc` from the same harness anchor and pass it via `--config`; do not rely on cwd discovery — the no-commit path runs with `cwd = project.root`. Rules out: loading the target repo's config or none, drifting from `lint:md`'s rule set.
- Emit runs autofix only and ignores the binary's exit status; do not fail emit on residual non-autofixable violations. Rules out: the reverted residual-failure path that pre-empted the frontmatter/name validation errors existing tests assert.
- Default: `MD041`/`MD025`-class rules do not fire on frontmatter-led intents (the leading `---` block satisfies first-heading rules), so no residual-failure path exists. Confirm empirically under the pinned binary+config; only if they fire may a residual path be added, and it must run after frontmatter/name validation, never before.
- Keep issue references off line-start in structural repair so `MD018` never fires on `#NNN` and autofix never promotes it to a heading. Rules out: a lint-clean but corrupted file (`#499` → `# 499`).
- Place autofix in the shared `repairIntentStageContent` step, after structural repair and before validation and the rename, with no path-specific branch. Rules out: divergent commit/no-commit emit behavior.

## Task checklist

- Stop structural repair from emitting a line-leading `#NNN` issue reference in `v1/src/commands/intent.ts`.
- Add a `markdownlint-cli2 --fix` pass to `repairIntentStageContent`, after structural repair and before validation, over the staged markdown files, using the pinned binary and `.markdownlint-cli2.jsonc` resolved from the harness anchor via `--config`, ignoring the binary's exit status.
- Confirm `MD041`/`MD025`-class rules do not fire on frontmatter-led intents under the pinned binary+config; drop any residual-failure path.
- Add tests: (a) `#NNN` reference stays a reference through repair+autofix; (b) seeded `MD012`+`MD018` content is dirty pre-fix and clean post-fix; (c) the no-commit/external path is autofixed against the harness config.
- Confirm existing name/`## Prerequisites` repair and validation tests still pass.

## Acceptance criteria

- [ ] After `jarvis intent` fan-out, running `bun run lint:md` over the generated `ready-intents/*.md` tree exits 0 with no operator edits, for inputs that would otherwise trip `MD012` and `MD018`.
- [ ] Autofix runs the pinned binary `bun node_modules/markdownlint-cli2/markdownlint-cli2.js` (not `npx`), with `.markdownlint-cli2.jsonc` resolved from the harness anchor and passed via `--config` — same rule set as the `lint:md` ready step, no cwd-discovered or relaxed config.
- [ ] An issue reference written into intent content (e.g. `#499`) is still a reference after repair + autofix — not promoted to a heading (`# 499`).
- [ ] Autofix runs in the shared `repairIntentStageContent` step on both the commit and no-commit (external) paths, after structural repair and before validation and the rename into `ready-intents/` — no path-specific branch.
- [ ] Emit applies autofix only and does not fail on residual non-autofixable violations; the existing frontmatter/name and Prerequisites validation errors are still surfaced. The repair + validation cases in `v1/test/intent-command.sandbox-unrunnable.test.ts` stay green (behavior otherwise unchanged).
- [ ] A new test in `v1/test/intent-command.sandbox-unrunnable.test.ts` exercises the repair step on seeded staging content tripping `MD012` and `MD018`, asserts it is dirty before the pass and lint-clean after (bytes changed), and asserts a `#NNN` reference is preserved.
- [ ] `lint:md` remains a step in the full ready tier in its existing position in `scripts/ready.ts` — not relaxed or reordered.
- [ ] The full `intent-command.sandbox-unrunnable.test.ts` suite passes against `main`'s tree, not only the implementation worktree. (Manual)

## Documentation updates

- `v1/docs/intent-mode.md`: extend the emit-contract repair description to note staged intents are markdownlint-autofixed to `lint:md`-clean via the pinned binary before validation, that issue references are kept off line-start so they are not promoted to headings, and that emit applies autofix only (no residual-failure path).
- `v2/docs/v1-behaviors.md`: update the intent fan-out / emit-contract repair entry to record that emitted ready-intents are markdownlint-autofixed against `lint:md`'s config (pinned binary) before validation, references are preserved, and emit does not fail on residual violations.
