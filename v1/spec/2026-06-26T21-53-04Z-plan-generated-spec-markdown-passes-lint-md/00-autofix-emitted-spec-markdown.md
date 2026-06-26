# Autofix emitted spec markdown

## Problem

Plan-generated spec markdown (`index.md`, subspecs) can trip the ready tier's
`lint:md` — observed `MD034` bare URL (e.g. a `repo: https://github.com/...`
example copied from spec guidance into LLM-authored content). The draft PR's
`bun run ready` then fails at `lint:md`, the PR is never auto-readied, and the
operator hand-fixes the markdown.

Fix it at the source: after the draft phase emits files and before the draft
commit, run markdownlint `--fix` over the emitted spec tree so the committed
markdown is lint-clean. Keep the ready tier's `lint:md` step untouched and
authoritative.

## Decisions

- Run the autofix after `stripNonContractIndexLines` and before the draft commit/boundary check, in the `commit:true` draft flow (`v1/src/modes/plan/run.ts`).
- Use jarvis's bundled `markdownlint-cli2` with `--fix`, the same tool `lint:md` invokes, so fixes match the gate.
- Glob only the emitted spec directory (`<specDir>/**/*.md`); cwd inside the spec tree for config auto-discovery.
- Swallow markdownlint's residual non-zero exit (unfixable rules remain); do not fail plan generation on it.

## Task checklist

- [ ] Add a generate-step autofix that runs `markdownlint-cli2 --fix` over the emitted spec files.
- [ ] Wire it into the `commit:true` draft flow before the draft commit/boundary check.
- [ ] Make it best-effort (no abort on residual violations).
- [ ] Test: a generated spec tree containing a bare URL is lint-clean (no MD034) after the autofix.
- [ ] Test: files outside the spec directory are untouched.
- [ ] Docs: `v1/docs/plan-mode.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] A `commit:true` plan draft whose emitted markdown contains a bare URL passes `bun run lint:md` with no `MD034` violation, without operator intervention.
- [ ] The autofix runs after the draft phase and before the draft commit, over the emitted spec tree only; files outside the spec directory are unmodified (the plan write boundary still holds).
- [ ] Residual non-autofixable lint violations do not abort plan generation; `jarvis1 plan` still completes and opens the draft PR.
- [ ] The full ready tier still runs `lint:md` after `check`, unchanged — not relaxed, removed, or reordered (`scripts/ready.ts`).
- [ ] `v1/docs/plan-mode.md` documents the generate-step autofix and `v2/docs/v1-behaviors.md` records the new generate behavior.

## Documentation updates

- `v1/docs/plan-mode.md`: note that the generate step runs markdownlint `--fix` over emitted spec files before the draft commit (best-effort; ready tier authoritative).
- `v2/docs/v1-behaviors.md`: add the generate-step autofix to the plan-mode behavior catalog.
