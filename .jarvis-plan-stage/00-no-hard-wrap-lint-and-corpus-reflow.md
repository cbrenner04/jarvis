# No-hard-wrap lint and corpus reflow

Hard-wrapped authored markdown will fail `lint:md` once a rule exists; the ready gate runs `lint:md` on the lint-covered corpus. A rule without deterministic reflow leaves the gate red; agent-hand reflow is non-repeatable.

## Decision ledger

- Custom `markdownlint-cli2` rule flags soft line breaks inside paragraph or list-item prose on the markdown-it token stream — rules out a line-regex rule.
- Exempt fenced code blocks, tables, HTML blocks, YAML front matter, explicit hard breaks (trailing `\` or two trailing spaces), and deeper-indented continuation lines within a list item — rules out blanket no-wrap lint and flagging intentional list continuations (`global.no-hard-wrap` prose).
- Custom rule module `scripts/markdownlint-no-hard-wrap-rule.ts`, registered via `.markdownlint-cli2.jsonc` `customRules`, rule id `no-hard-wrap` — rules out stock `MD*` ids or ad hoc module paths.
- Deterministic AST reflow script `scripts/reflow-markdown.ts` joins wrapped paragraph and list-item lines; leaves fenced code blocks, tables, front matter, and reference-link definition blocks byte-identical — rules out agent-hand corpus edits.
- `bun run reflow:md` invokes the reflow script over the same globs and ignores as `.markdownlint-cli2.jsonc` — rules out a one-off manual invocation with no operator entrypoint.
- Custom rule and corpus reflow land in this subspec — rules out a split that leaves `lint:md` red between rule-only and reflow-only iterations.
- `MD013` stays `false` — rules out a max-length rule.
- Reflow corpus scope follows existing `.markdownlint-cli2.jsonc` globs and ignores (`**/completed/**`, `**/verdict-*.md` excluded) — rules out touching generated or ignored markdown.

## Prerequisites

- `global.no-hard-wrap` composes into intent, plan, write, and patch step prompts (`prompts/global/no-hard-wrap.md`, `shared/prompts/intent-split.test.ts`, `v2/src/execution/write-prompt.test.ts`).
- `bun run lint:md` lints markdown bounded by `.markdownlint-cli2.jsonc` globs and ignores (`package.json`, `scripts/markdownlint-globs.test.ts`).

## Work

- Implement `scripts/markdownlint-no-hard-wrap-rule.ts` and register it in `.markdownlint-cli2.jsonc` with an inline comment.
- Add `scripts/markdownlint-no-hard-wrap.test.ts` covering each exemption, positive detection, and pre-fix failure against the stock config.
- Implement `scripts/reflow-markdown.ts` and `bun run reflow:md` in `package.json`.
- Add `scripts/reflow-markdown.test.ts` with wrapped fixtures that fail pre-fix and pass after reflow; assert idempotency.
- Run `bun run reflow:md` on the lint-covered corpus and commit the reflowed files.
- Update durable docs listed below.

## Acceptance criteria

- [ ] `scripts/markdownlint-no-hard-wrap.test.ts` asserts the custom rule flags intra-paragraph and intra-list-item soft line breaks and passes each exemption case; the suite fails against the pre-fix config without the custom rule.
- [ ] `scripts/reflow-markdown.test.ts` asserts wrapped paragraph and list-item fixtures reflow to one physical line per block, leaves code blocks, tables, front matter, and reference-link definitions byte-identical, and is idempotent on re-run; the suite fails against pre-fix wrapped fixtures.
- [ ] `bun run reflow:md` leaves the lint-covered corpus clean: `bun run lint:md` reports zero errors after reflow.
- [ ] Mutation checkpoint: the positive-detection test in `scripts/markdownlint-no-hard-wrap.test.ts` carries a `// @mutate` directive on `scripts/markdownlint-no-hard-wrap-rule.ts` that disables detection; applying it turns that test red.
- [ ] Mutation checkpoint: the reflow fixture test in `scripts/reflow-markdown.test.ts` carries a `// @mutate` directive on `scripts/reflow-markdown.ts` that disables paragraph/list join; applying it turns that test red.
- [ ] `bun run lint:md`, `bun run typecheck`, and `bun run test` pass.

## Documentation updates

- `v1/docs/spec-guidance.md` — record the no-hard-wrap authored-markdown convention; reconcile the mutation-checkpoint bullet that wrapping a pinning-test reference onto a continuation line is safe (parser still tolerates it; no longer authored style).
- `v2/docs/v1-behaviors.md` — record that `lint:md` enforces the `no-hard-wrap` custom rule on the lint-covered corpus.
- `.markdownlint-cli2.jsonc` — comment the new custom rule.
