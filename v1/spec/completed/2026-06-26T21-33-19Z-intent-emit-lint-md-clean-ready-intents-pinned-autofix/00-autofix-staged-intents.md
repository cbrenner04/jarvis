# Autofix staged intents with the pinned markdownlint-cli2 binary

## Problem

`jarvis intent` fan-out writes ready-intents under `v1/spec/.../ready-intents/`,
inside the `.markdownlint-cli2.jsonc` lint globs. Emitted files trip active
default rules (`MD012` consecutive blank lines after an appended empty
`## Prerequisites`; `MD018` missing ATX space on a line-leading `#NNN` the model
splitter emitted), so the post-generation `bun run ready` fails at `lint:md` and
the operator hand-fixes the markdown.

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

- Fix the two known, self-inflicted violations deterministically in-TS in `repairIntentFile`: `MD012` by trimming trailing blank lines before appending `## Prerequisites` (the appended block followed content already ending in `\n`); `MD018` by keeping issue references off line-start (see next). Rules out: delegating a known, deterministic defect to a subprocess that may be absent or that *causes* the `MD018` corruption.
- Run a `markdownlint --fix` autofix pass anyway, as a general net over arbitrary model-emitted markdown beyond today's two rules. Rules out: assuming the splitter only ever emits MD012/MD018 — autofix catches the next unanticipated default-rule violation without a code change.
- Keep issue references off line-start at the point they are written (model-splitter prompt / a content-normalization step over the split output), **before** autofix runs. Autofix cannot be relied on here: MD018 autofix *inserts* the space (`#499` → `# 499`), promoting the reference to a heading — it causes the corruption, it does not prevent it. The reference must already be safe when autofix sees it. Rules out: trusting autofix to protect `#NNN`.
- Run the autofix subprocess via the pinned binary `bun node_modules/markdownlint-cli2/markdownlint-cli2.js`, never `npx`. Resolve the repo root by walking up from `import.meta.dir` to the directory containing `node_modules/markdownlint-cli2/` and `.markdownlint-cli2.jsonc`; build the binary, config, and file paths as absolute paths from that anchor. Rules out: npx resolution that passes a branch gate but breaks `intentCommand` on `main`; relative paths resolving against `cwd = project.root` (the no-commit path) instead of the harness.
- Spawn the subprocess with **cwd set to the harness anchor** (not `project.root`) and pass `.markdownlint-cli2.jsonc` via `--config`. `--config` sets a base only; markdownlint-cli2 still layers directory-discovered configs on top, so running under `project.root` would let a target-repo markdownlint config override the harness rule set. Anchoring cwd confines discovery to harness-owned directories. Rules out: target-repo config drift on exactly the path the intent calls out.
- Distinguish two subprocess outcomes. (a) Nonzero exit from residual non-autofixable lint violations: ignore — emit applies autofix only and never fails on residual violations (this is the reverted path that pre-empted frontmatter/name validation; do not reintroduce it). (b) Spawn failure / binary absent (this worktree has no `node_modules`, so the path genuinely may not resolve): warn to stderr and continue with the in-TS-repaired (still-valid) content — never pass silently, since silent no-op reintroduces the operator hand-fixing this spec exists to remove. Rules out: conflating residual-violation exit with spawn failure.
- `MD041`/`MD025` do not fire on these intents. Reason: the H1 *after* the frontmatter satisfies MD041's first-heading requirement (MD041's `front_matter_title` matches a `title:` key, which intents do not use — the `name:`-only frontmatter does not satisfy it; the H1 does). This is a **one-time manual observation under the pinned binary+config, with no encoded guard** — no residual-failure path is added. If a future change makes them fire, the manual `(Manual)` AC below catches it. Rules out: the incorrect claim that the `---` frontmatter block itself satisfies MD041.
- Place the autofix pass in the shared `repairIntentStageContent` step, after in-TS structural repair and before validation and the rename, with no path-specific branch. Rules out: divergent commit/no-commit emit behavior.

## Task checklist

- In `repairIntentFile` (`v1/src/commands/intent.ts`): trim trailing blank lines before appending `## Prerequisites` (kills MD012 in-TS).
- Keep issue references off line-start where the split content is produced/normalized, before any autofix — so MD018 never has a `#NNN` to (mis)fix.
- Add a `markdownlint --fix` pass to `repairIntentStageContent`, after structural repair and before validation, over the staged markdown files: pinned binary + absolute `--config`, anchor-resolved, cwd at the harness anchor. Ignore residual-violation nonzero exit; warn (don't fail/silently-skip) on spawn failure / absent binary.
- Manually confirm `MD041`/`MD025` do not fire on frontmatter-led intents under the pinned binary+config; add no residual-failure path.
- Add tests: (a) `#NNN` reference stays a reference through repair (kept off line-start, not mis-fixed); (b) seeded `MD012`+`MD018` content is dirty pre-fix and clean post-fix — skip-with-signal when the binary is absent; (c) the no-commit/external path is repaired+autofixed against the harness config, not a target-repo config.
- Confirm existing name/`## Prerequisites` repair and validation tests still pass.

## Acceptance criteria

- [x] Autofix runs the pinned binary `bun <repo-root>/node_modules/markdownlint-cli2/markdownlint-cli2.js` (absolute, anchor-resolved — not `npx`, not a literal relative path), with `.markdownlint-cli2.jsonc` passed via `--config` as an absolute anchor-resolved path.
- [x] The autofix subprocess runs with cwd at the harness anchor, so directory-discovered markdownlint config under `project.root` (the no-commit path's cwd) cannot override the harness rule set. A test on the no-commit/external path places a conflicting markdownlint config at `project.root` and asserts the harness rule set still governs the result.
- [x] The MD012 (`## Prerequisites` append) and MD018 (`#NNN` line-start) causes are fixed in-TS before autofix runs: the appended `## Prerequisites` introduces no consecutive blank lines, and an issue reference (e.g. `#499`) is kept off line-start so autofix never sees a line-leading `#NNN`.
- [x] An issue reference written into intent content (e.g. `#499`) is still a reference after repair — not promoted to a heading (`# 499`). The guarantee comes from keeping it off line-start before autofix, not from autofix.
- [x] Autofix runs in the shared `repairIntentStageContent` step on both the commit and no-commit (external) paths, after structural repair and before validation and the rename into `ready-intents/` — no path-specific branch.
- [x] Emit applies autofix only and does not fail on residual non-autofixable violations; the existing frontmatter/name and Prerequisites validation errors are still surfaced. The repair + validation cases in `v1/test/intent-command.sandbox-unrunnable.test.ts` stay green (behavior otherwise unchanged).
- [x] Spawn failure / absent binary warns to stderr and continues with the in-TS-repaired content; it does not fail emit and does not pass silently. A test simulating an unresolvable binary asserts the warning and that the in-TS repairs (MD012/MD018) are still present.
- [x] A new test in `v1/test/intent-command.sandbox-unrunnable.test.ts` exercises the repair step on seeded staging content tripping `MD012` and `MD018`, asserts it is dirty before the pass and lint-clean after (bytes changed), and asserts a `#NNN` reference is preserved. The test requires installed deps + a resolvable binary + spawn; it skips with a signal (not an opaque error) when the binary is absent.
- [x] `lint:md` remains a step in the full ready tier in its existing position in `scripts/ready.ts` — not relaxed or reordered.
- [x] After `jarvis intent` fan-out, `bun run lint:md` over the generated `ready-intents/*.md` tree exits 0 with no operator edits, for inputs that would otherwise trip `MD012` and `MD018`; and `MD041`/`MD025` do not fire on frontmatter-led intents. (Manual — integration over the real tree, not the unit file.)
- [x] The full `intent-command.sandbox-unrunnable.test.ts` suite passes against `main`'s tree, not only the implementation worktree. (Manual)

## Documentation updates

- `v1/docs/intent-mode.md`: extend the emit-contract repair description — staged intents have their two self-inflicted violations (MD012 from the `## Prerequisites` append, MD018 from line-leading `#NNN`) fixed in-TS, then get a pinned-binary `markdownlint --fix` pass (cwd anchored to the harness so target-repo config cannot drift the rule set) as a general net, before validation; issue references are kept off line-start *before* autofix (autofix would otherwise promote them to headings); emit applies autofix only (no residual-failure path), and a spawn failure / absent binary warns and continues rather than failing or silently no-op'ing.
- `v2/docs/v1-behaviors.md`: update the intent fan-out / emit-contract repair entry — emitted ready-intents are fixed in-TS for MD012/MD018 then markdownlint-autofixed against `lint:md`'s config (pinned binary, harness-anchored cwd) before validation; references are preserved by upfront off-line-start placement; emit does not fail on residual violations and warns on spawn failure.
