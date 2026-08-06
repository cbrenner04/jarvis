---
name: authored-markdown-avoids-hard-wrapping
---

# Authored markdown should not hard-wrap; enforce it with lint

Agents hard-wrap authored markdown (specs, ready-intents, seeds, docs, PR bodies) at ~100 columns purely by habit. Nothing requires it: `MD013` (line length) is already `false` in `.markdownlint-cli2.jsonc`, and no intent/plan/write prompt instructs wrapping. The hard-wrap splits load-bearing single-logical-line constructs — `@mutate` directives and acceptance-criterion bullet blocks — across physical lines, which is a recurring source of harness friction and has forced parser workarounds. Natural authoring (one physical line per paragraph and per list item, editor soft-wrap) removes the whole failure class.

## Evidence

- `MD013` and several other rules (`MD032`, `MD040`) are disabled in `.markdownlint-cli2.jsonc` with the explicit reason "would require corpus reflow (out of scope)" — so today's hard-wrap is convention, not a rule, and the inverse rule (max length) is the only line-shape rule markdownlint ships.
- The mutation-checkpoint verifier had to gain "full bullet block" continuation-line reassembly (#2618–2620) specifically to tolerate criterion text wrapped across physical lines; `v1/docs/spec-guidance.md` even documents that wrapping a pinning-test reference onto a continuation line is "safe" — an accommodation the parser only makes because authors wrap.
- 2026-08-06 (this session): an implement run blocked because a wrapped `@mutate` directive would only parse when kept on one long line inside backticks.
- CI does not run `lint:md`; only the implement ready gate and manual operator runs do.

## Decisions

- **Prompt directive.** Add a global prompt fragment (composed via `prompts/registry.txt`, alongside `global/terse.md` / `global/naming.md`) instructing intent/plan/write/patch agents to author markdown with one physical line per paragraph and per list item — no hard line-wrapping — and to let it wrap naturally. Applies to specs, ready-intents, seeds, docs, and PR bodies. Code-comment `@mutate` directives stay single-line (already required).
- **Custom lint rule.** Add a `markdownlint-cli2` custom rule that flags a soft line break inside a paragraph or list-item text block. Exempt fenced code blocks, tables, HTML blocks, YAML front-matter, and explicit hard breaks (trailing backslash or two trailing spaces). Operate on the markdown token stream, not a line regex.
- **Deterministic corpus reflow.** Reflow every currently-lint-covered markdown file so the new rule passes. The reflow MUST be a deterministic AST-based transform (a committed script), never an agent free-handing files — it joins wrapped paragraph/list-item lines into one and leaves code blocks, tables, front-matter, and reference-link definitions byte-identical. Corpus is bounded by the existing `.markdownlint-cli2.jsonc` globs/ignores (`**/completed/**` and `**/verdict-*.md` already excluded).
- The custom rule and the reflow land together so the ready gate never goes red in between. `MD013` stays `false`; do not add a max-length rule.
- Do not touch generated or ignored markdown. Keep the reflow script in the repo (`scripts/`) so it can be re-run.

## Acceptance criteria

- [ ] A global prompt fragment instructs agents not to hard-wrap authored markdown and is registered in `prompts/registry.txt`; a test asserts the fragment text is present and composed into the intent/plan/write prompts.
- [ ] `.markdownlint-cli2.jsonc` loads a custom rule that flags an intra-paragraph / intra-list-item soft line break, exempting code blocks, tables, HTML, front-matter, and hard breaks; the rule has unit tests covering each exemption and a positive detection.
- [ ] A committed deterministic reflow script reflows the lint-covered corpus; running `bun run lint:md` on the reflowed corpus reports zero errors, and re-running the script is a no-op (idempotent).
- [ ] `bun run lint:md`, `bun run typecheck`, and the touched test scope pass.

## Documentation updates

- `v1/docs/spec-guidance.md` — record the no-hard-wrap convention for authored markdown; reconcile the "wrapping a pinning-test reference onto a continuation line is safe" note (still tolerated by the parser, but no longer the authored style).
- `AGENTS.md` — note the no-hard-wrap convention alongside "be terse."
- `.markdownlint-cli2.jsonc` — comment the new custom rule.

## Prerequisites

- `prompts/global/*` fragments and `prompts/registry.txt` composition (see `prompts/global/documentation.md`, `prompts/global/terse.md`).
- `.markdownlint-cli2.jsonc` and the `lint:md` script.
- The mutation-checkpoint verifier's continuation-line reassembly (`v2/src/execution/mutation-checkpoint-verifier.ts`) — unaffected, but the reason it exists.
