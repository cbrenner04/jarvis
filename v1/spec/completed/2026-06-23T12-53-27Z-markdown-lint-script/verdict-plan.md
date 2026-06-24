# Verdict — Refinements Required

The spec ships a real risk of passing while doing nothing, and under-designs its central deliverable. Refine as follows.

## Required refinements

1. **Pin the glob form to recurse into `.md` files.** The Decisions and Task write the scoped trees as bare directory paths (`v1/spec`, `reports/`). markdownlint-cli2 passes globs to globby, where a bare directory matches the directory entry, not its `.md` descendants — so the config can match zero files. The spec must explicitly specify the recursive `.md` glob form (e.g. `v1/spec/**/*.md`) for every scoped tree.

2. **Add a positive evidence-of-work acceptance criterion.** The current AC ("non-zero exit acceptable, crash not acceptable") cannot distinguish "linted the corpus and found violations" from "matched zero files and exited 0 green." The spec needs an AC asserting the command actually processes a known-nonzero set of files across the scoped trees, so a zero-match config fails acceptance instead of passing it. This closes the spec's most dangerous broken-but-green path.

3. **Bind house-style tuning to the actual corpus, not a two-rule sample.** The intent's central ask is a config tuned to existing house style; the spec designs only MD013 and MD033 and waves at "the rest." markdownlint enables all rules by default, and the real corpus will blanket-fire on rules the spec never names (e.g. first-line-heading and duplicate-heading patterns from frontmatter and repeated `## Problem`/`## Decisions` section headings). Do **not** enumerate every rule's verdict — that invents precision before the corpus output exists. Instead the spec must require running against the real corpus and triaging the rules that actually fire (keep rules enforcing genuine conventions, disable pervasive house-style ones), and the signal AC must reference genuine deviations generally, not only MD013/MD033.

4. **Add a Bun-compatibility fallback.** The spec commits to markdownlint-cli2 as the sole tool with "confirm it runs under Bun" but no contingency. Per repo convention, add a Blocker path: if it will not run cleanly under Bun, append `## Blocker` and stop rather than guess.

5. **Pin the script invocation form to repo convention.** Existing scripts invoke tools via an explicit `bun node_modules/.../bin/...` path, never a bare binary name. The spec leaves "bare `markdownlint-cli2` or the installed binary path" as an unresolved either/or; resolve it to the explicit path form, which also de-risks Bun resolution (ties to #4).

## Clarity nits (one clause each)

6. **CSV exemption.** The intent explicitly raised generated CSV-adjacent files; the spec's "out of scope by omission" lists `v2/**` but is silent on CSVs. Add one clause noting markdownlint processes only `.md` so CSVs need no ignore — confirm it was considered.

7. **Drop "format" from the title.** The index H1 carries "lint/format" from the intent name, but the spec decisively scopes out format/autofix. Correct the misleading H1 (directory slug is cosmetic and may stay).

## Rationale

Refinements 1–2 are correctness: spec guidance requires acceptance criteria that verify observable target state, and an AC that greenlights a zero-file run verifies nothing. Refinement 3 keeps the deliverable signal-bearing (the intent's core purpose) while honoring the deferral principle — bind to observed output rather than guessing rule verdicts. Refinements 4–5 align with confirmed repo conventions at near-zero cost. 6–7 remove reviewer ambiguity.