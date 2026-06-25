# Emit lint:md-clean ready-intents

## Problem

`jarvis intent` fan-out writes ready-intents under `v1/spec/.../ready-intents/`,
inside the `.markdownlint-cli2.jsonc` lint globs. Emitted files trip active
default rules (`MD012` consecutive blank lines after an appended empty
`## Prerequisites`, `MD018` missing ATX space on a wrapped line-leading `#499`).
The post-generation `bun run ready` then fails at `lint:md`, the draft PR is
never auto-readied, and the operator hand-fixes the markdown.

The emit-contract repair (`repairIntentStageContent` → `repairIntentFile` in
`v1/src/commands/intent.ts`, called on both the commit path and the no-commit
external path before `validateIntentStageContent` and before the rename into
`ready-intents/`) already normalizes `name:` frontmatter and appends
`## Prerequisites`. Make emitted files `lint:md`-clean — without silently
corrupting content and without shipping residual violations downstream.

## Decisions

- Autofix is not unconditionally meaning-preserving: `MD018`'s fix inserts a space at a line-leading `#499`, promoting an issue reference to an H1. So treat blind autofix and content correctness as distinct — "shares lint's engine" does not mean "produces the correct document."
- Resolve `MD018`-on-issue-references at the source, not by autofix: the structural repair must not emit a line-leading `#NNN` issue reference (do not wrap such a reference to line start), so the rule never fires on it and autofix never rewrites a reference into a heading. Rules out: letting `--fix` "correct" `#499`→`# 499` and passing a lint-clean but corrupted file.
- Run `markdownlint-cli2 --fix` for the whitespace/blank-line normalization it does preserve (covers `MD012`), after the `name:`/`## Prerequisites` structural repair (which itself introduces the blank-line violations) and before `validateIntentStageContent`. Rules out: hand-rolled per-rule string edits that rot when a new default rule trips.
- Respect the autofix exit status: `markdownlint-cli2 --fix` exits non-zero when violations remain after fixing (non-autofixable rules — e.g. `MD041`/`MD025`/`MD026`). Treat a still-dirty file as an emit failure surfaced at fan-out (named error, before the rename into `ready-intents/`), not a silent pass. Rules out: shipping a residually-dirty file that fails `lint:md` only later in the ready tier where the failure is invisible.
- Resolve `.markdownlint-cli2.jsonc` relative to a fixed harness-repo anchor (the source module location, not cwd) and pass it explicitly via `--config`. The no-commit path runs with `cwd = project.root`; cwd-based discovery would load the target repo's config or none. Rules out: drift between autofix's rule set and lint:md's.
- Place all of the above in the shared `repairIntentStageContent` step so it applies identically on the commit and no-commit paths with no path-specific branch.
- Do not change the ready tier: `lint:md` stays authoritative, same step, same position.

## Task checklist

- Stop the structural repair from emitting a line-leading `#NNN` issue reference in `v1/src/commands/intent.ts`.
- Add a `markdownlint-cli2 --fix` pass to `repairIntentStageContent`, after structural repair and before validation, on the staged markdown files, with `.markdownlint-cli2.jsonc` resolved from the harness anchor and passed via `--config`.
- Make a non-zero post-fix exit status surface as a named emit failure before the rename into `ready-intents/`, on both paths.
- Add tests: (a) a `#NNN` reference stays a reference through repair+autofix; (b) seeded `MD012`+`MD018` content is dirty pre-fix and clean post-fix; (c) the no-commit/external path is autofixed against the harness config; (d) residual non-autofixable violation fails emit with a named error.
- Confirm existing name/`## Prerequisites` repair tests still pass.

## Acceptance criteria

- [ ] After `jarvis intent` fan-out, running `bun run lint:md` over the generated `ready-intents/*.md` tree exits 0 with no operator edits, for inputs that would otherwise trip `MD012` and `MD018`.
- [ ] An issue reference written into intent content (e.g. `#499`) is still an issue reference after repair + autofix — it is not promoted to a heading (no `# 499`).
- [ ] A staged file with violations that remain after autofix (a non-autofixable rule) causes `jarvis intent` to fail with a named error before any file is renamed into `ready-intents/`, rather than emitting the dirty file.
- [ ] Autofix uses the same markdownlint config the `lint:md` ready step uses, resolved from the harness repo and passed explicitly — no separate, relaxed, or cwd-discovered rule set.
- [ ] The no-commit (external) staging path is autofixed against the harness config, same as the commit path — no path-specific branch.
- [ ] A new test in `v1/test/intent-command.sandbox-unrunnable.test.ts` exercises the emit-contract repair step on seeded staging content containing `MD012` and `MD018`, asserts the seeded content is dirty before the pass and lint-clean after (bytes changed), and asserts a `#NNN` reference is preserved.
- [ ] The existing repair cases in `v1/test/intent-command.sandbox-unrunnable.test.ts` (name and `## Prerequisites` repair) stay green — structural repair behavior otherwise unchanged.
- [ ] `lint:md` remains a step in the full ready tier in its existing position in `scripts/ready.ts` — not relaxed or reordered.

## Documentation updates

- `v1/docs/intent-mode.md`: extend the emit-contract repair description (the "harness-enforced with deterministic repair" paragraph) to note staged intents are markdownlint-autofixed to `lint:md`-clean before validation, that issue references are kept off line-start so they are not promoted to headings, and that a residual non-autofixable violation fails emit.
- `v2/docs/v1-behaviors.md`: update the intent fan-out / emit-contract repair entry to record that emitted ready-intents are markdownlint-autofixed against lint:md's config before validation, references are preserved, and residual violations fail emit.
