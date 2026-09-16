# Collapse the attribution footer into `<details>`

## Problem

`renderAttribution` in `v2/src/execution/pr-attribution.ts` renders commit bullets, `Written by … through Jarvis.`, and `<label> — Steps: …` as visible body text.

## Decisions

- Non-empty footer is wrapped as `<details><summary>Jarvis attribution</summary>`, blank line, existing bullets/`Written by`/Steps lines, blank line, `</details>`; blank lines are required so GitHub renders the markdown inside.
- Empty footer stays `""` (no empty `<details>`), so the no-separator path in `pr-body-refresh.ts` is unchanged.
- Footer content and ordering inside the block are unchanged; only the wrapper is added.
- `pr-body-refresh.ts`'s `---` separator is unchanged and needs no edit: it still precedes whatever `renderFooter` returns, so it lands directly above the `<details>` block exactly as it landed above the unwrapped footer today.

## Acceptance criteria

- [ ] A test in `v2/src/execution/pr-attribution.test.ts` asserts `Written by`, `— Steps:`, and each `<shortSha> <subject> — <label>` bullet appear only between `<details><summary>Jarvis attribution</summary>` and `</details>`; it fails against the pre-fix code.
- [ ] A test in `v2/src/execution/pr-body-refresh.test.ts` drives `refreshPrBody` through a real git-repo fixture (à la `pr-attribution.test.ts`'s `gitInit`/`commitWithMessage` helpers) with one `Spec:`-prefixed qualifying commit, using the real (unmocked) `deriveSpecRunBodySummary` as `bodySummary` and the real (unmocked) `renderAttribution` footer (only `fetchPrBody`/`writePrBody` are stubbed). It asserts the written body contains that commit's subject and `— <label>` exactly once, and contains no `## Commits` heading; it fails against the pre-fix code (today `## Commits`, from the unfiltered commit list, duplicates the footer's subject/label bullet for any commit qualifying under both).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` § Commit trailers and PR attribution — footer is one collapsed `<details>` block holding the single commit list, `Written by`, and Steps lines.
- `v2/docs/write-behavior.md` § PR body refresh — the inline footer description (bullet shape, `Written by`, Steps) now describes content rendered inside the `<details>` wrapper, not bare body text.
- `v2/docs/v1-behaviors.md` — note v2 collapses the footer into `<details>` (v1 renders it inline).
