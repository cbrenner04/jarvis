# No-hard-wrap lint and corpus reflow

Hard-wrapped authored markdown will fail `lint:md` once a rule exists; the ready gate runs `lint:md` on the lint-covered corpus. A rule without deterministic reflow leaves the gate red; agent-hand reflow is non-repeatable.

This subspec is authoritative over plan-stage `intent.md` for implementation detail (unified exemption matrix, gate-visible test paths, dual mutation checkpoints).

## Decision ledger

- Custom `markdownlint-cli2` rule flags soft line breaks inside paragraph or list-item prose on the markdown-it token stream — rules out a line-regex rule.
- Shared exemption matrix (rule, `reflow:md`, and pinning tests must agree — see below) — rules out rule/reflow drift on the same file.
- Custom rule module `scripts/markdownlint-no-hard-wrap-rule.ts`, registered via `.markdownlint-cli2.jsonc` `customRules`, rule id `no-hard-wrap` — rules out stock `MD*` ids or ad hoc module paths.
- Deterministic AST reflow script `scripts/reflow-markdown.ts` joins wrapped paragraph and list-item prose lines — rules out agent-hand corpus edits.
- `bun run reflow:md` invokes the reflow script over the same globs and ignores as `.markdownlint-cli2.jsonc` — rules out a one-off manual invocation with no operator entrypoint.
- Gate-visible pinning tests live under `test/` (`scripts/*.test.ts` is outside `bun run test` and mutation scope) — rules out hollow mutation checkpoints.
- Custom rule and corpus reflow land in this subspec — rules out a split that leaves `lint:md` red between rule-only and reflow-only iterations.
- `MD013` stays `false` — rules out a max-length rule.
- Reflow corpus scope follows existing `.markdownlint-cli2.jsonc` globs and ignores (`**/completed/**`, `**/verdict-*.md` excluded) — rules out touching generated or ignored markdown.
- Write-step autofix / `markdownlint --fix` for `no-hard-wrap` — out of scope (operator repair is `bun run reflow:md`).

## Shared exemption matrix

Rule lint, reflow preservation, and both pinning suites exercise the same cases:

| Case | Rule | Reflow |
| --- | --- | --- |
| Fenced code blocks | exempt | byte-identical |
| Tables | exempt | byte-identical |
| Block-level HTML blocks (not inline tags within prose) | exempt | byte-identical |
| YAML front matter | exempt | byte-identical |
| Explicit hard breaks (trailing `\` or two trailing spaces) | exempt | byte-identical |
| List-item continuation lines: deeper indent than the bullet marker, no new list marker (per `global.no-hard-wrap`) | exempt | byte-identical |
| Reference-link definition blocks | exempt | byte-identical |
| Intra-paragraph soft line break | flag | join to one physical line |
| Intra-list-item soft line break at the same marker indent | flag | join to one physical line |

## Prerequisites

- `global.no-hard-wrap` is on branch baseline: fragment file, registry entry, and assembly into intent, plan, write, and patch steps (`prompts/global/no-hard-wrap.md`, `shared/prompts/intent-split.test.ts`, `v2/src/execution/write-prompt.test.ts`, `v1/test/prompt.test.ts`). Sibling prompt spec need not merge first.
- `bun run lint:md` lints markdown bounded by `.markdownlint-cli2.jsonc` globs and ignores (`package.json`).

## Work

- Implement `scripts/markdownlint-no-hard-wrap-rule.ts` and register it in `.markdownlint-cli2.jsonc` with an inline comment (note block-level HTML vs inline tags).
- Add `test/markdownlint-no-hard-wrap.test.ts` covering the shared exemption matrix, positive detection, and pre-fix failure against a fixture config omitting the `no-hard-wrap` `customRules` entry.
- Implement `scripts/reflow-markdown.ts` and `bun run reflow:md` in `package.json` (read globs/ignores from `.markdownlint-cli2.jsonc`).
- Add `test/reflow-markdown.test.ts` exercising the same exemption matrix, wrapped paragraph/list prose fixtures that fail before reflow, idempotency, and pre-fix failure against wrapped fixtures when reflow is absent or a no-op.
- Add or extend a gate-visible test asserting `reflow:md` reads the same globs and ignores as `.markdownlint-cli2.jsonc` (e.g. `test/markdown-reflow-scope.test.ts`).
- Run `bun run reflow:md` on the lint-covered corpus and land reflowed files in the worktree (Jarvis owns commits).
- Update durable docs listed below.

## Acceptance criteria

- [ ] `.markdownlint-cli2.jsonc` registers `scripts/markdownlint-no-hard-wrap-rule.ts` as custom rule id `no-hard-wrap`.
- [ ] `test/markdownlint-no-hard-wrap.test.ts` asserts the custom rule flags intra-paragraph and intra-list-item soft line breaks, passes each shared-exemption-matrix case (including block-level HTML vs inline tags and list continuations), and fails against a fixture config without the `no-hard-wrap` `customRules` entry.
- [ ] `test/reflow-markdown.test.ts` asserts wrapped paragraph and list-item prose reflows to one physical line per prose run, leaves each shared-exemption-matrix preserve case byte-identical, is idempotent on re-run, and fails against pre-fix wrapped fixtures when reflow is absent or a no-op.
- [ ] Gate-visible test asserts `reflow:md` uses the same globs and ignores as `.markdownlint-cli2.jsonc`.
- [ ] `bun run reflow:md` leaves the lint-covered corpus clean: `bun run lint:md` reports zero errors after reflow.
- [ ] Mutation checkpoint: the positive-detection test in `test/markdownlint-no-hard-wrap.test.ts` carries a `// @mutate` directive on `scripts/markdownlint-no-hard-wrap-rule.ts` that disables detection; applying it turns that test red.
- [ ] Mutation checkpoint: the reflow fixture test in `test/reflow-markdown.test.ts` carries a `// @mutate` directive on `scripts/reflow-markdown.ts` that disables paragraph/list join; applying it turns that test red.
- [ ] `bun run lint:md`, `bun run typecheck`, and `bun run test` pass.

## Documentation updates

- `v1/docs/spec-guidance.md` — record the no-hard-wrap authored-markdown convention; reconcile the mutation-checkpoint bullet that wrapping a pinning-test reference onto a continuation line is safe (parser still tolerates it; no longer authored style).
- `v2/docs/v1-behaviors.md` — record that `lint:md` enforces the `no-hard-wrap` custom rule on the lint-covered corpus and `bun run reflow:md` is the repair path.
- `v1/docs/operator-runbook.md` and `v2/docs/operator-runbook.md` — document `bun run reflow:md` as the repair path when `no-hard-wrap` violations appear (mirror `lint:md` corpus scope).
- `README.md` — add `bun run reflow:md` to the Development section beside `lint:md`.
- `.markdownlint-cli2.jsonc` — comment the new custom rule.
