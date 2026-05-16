# 00 - Agent model labels and PR body footer

## Problem

`ensureDraftPr` writes the agent-generated body verbatim. The PR shows
no signal of which agent or model produced the work. Add a single
attribution line to the body when Jarvis creates the draft PR, derived
from the agent and its configured model.

## Decisions

- **Agent label API.** Extend the `Agent` interface in
  `src/agents/types.ts` with `attributionLabel(): string`. Each
  implementation (`ClaudeAgent`, `CodexAgent`, `CursorAgent`,
  `OpencodeAgent`) returns the human-readable string for its current
  configuration. The harness never inspects model strings directly;
  it just asks the agent for its label.
- **Label format per agent.**
  - `ClaudeAgent`: known IDs map to family+version (e.g.
    `claude-opus-4-7` → `Claude Opus 4.7`,
    `claude-sonnet-4-6` → `Claude Sonnet 4.6`,
    `claude-haiku-4-5-20251001` → `Claude Haiku 4.5`).
    Unknown ID → the raw string. Undefined model →
    `claude (default model)`.
  - `CodexAgent`, `CursorAgent`, `OpencodeAgent`: same shape. Each
    keeps its own small map of currently-known model IDs. Unknown
    ID → raw string. Undefined → `<cli-name> (default model)`.
  - The label is plain text. No "through Jarvis" yet — that lives in
    the caller's footer template.
- **Caller composes the footer.** In `src/modes/patch/run.ts`, the
  block that calls `ensureDraftPr` builds
  `Written by ${agent.attributionLabel()} through Jarvis.` and passes
  it as the new `attribution` opt.
- **`ensureDraftPr` opt.** Add `attribution: string` to
  `EnsureDraftPrOpts`. When the body is generated for a new PR, the
  final body sent to `gh pr create --body` is:

  ```
  <agent body, trimmed>

  ---

  <attribution>
  ```

  Separator is a markdown `---` rule preceded and followed by a blank
  line. If `attribution` is the empty string, no separator and no
  footer are appended.
- **No retroactive update.** When `checkPrExists` returns a number,
  `ensureDraftPr` returns without touching the existing body. The
  attribution is a one-time stamp at PR creation.

## Implementation hints

- The known-model map per agent is a private `Record<string, string>`
  in the agent file. Keep it small and let it grow as new IDs land.
- Tests for the label function can live in each agent's existing
  test file (or a new sibling `*.test.ts`) and should cover: known
  ID → mapped label, unknown ID → raw string, undefined → default
  fallback.
- For `ensureDraftPr`, the existing unit/integration tests run `gh`;
  add a focused test that asserts the body string passed to the
  command includes the attribution footer with the `---` separator,
  and that passing `attribution: ""` produces no footer or separator.
  Stub `execFileSync` the same way other PR tests do (see existing
  pattern in `src/pr.test.ts` if present; otherwise mirror the
  closest existing command-test scaffold).

## Task Checklist

- [ ] Add `attributionLabel(): string` to the `Agent` interface in
  `src/agents/types.ts`.
- [ ] Implement `attributionLabel` on `ClaudeAgent`, `CodexAgent`,
  `CursorAgent`, `OpencodeAgent` with the per-agent maps and
  fallbacks described above.
- [ ] Add `attribution: string` to `EnsureDraftPrOpts` in
  `src/pr.ts`. Append the footer block to the generated body
  before passing it to `gh pr create`. Empty string → no footer.
- [ ] In `src/modes/patch/run.ts`, build
  `Written by ${agent.attributionLabel()} through Jarvis.` and
  pass it as `attribution` when calling `ensureDraftPr`.
- [ ] Tests for each agent's `attributionLabel` (known, unknown,
  undefined cases).
- [ ] Test for `ensureDraftPr`: asserts the body passed to `gh`
  contains the footer with the `---` separator when attribution
  is non-empty; no footer when empty.
- [ ] `bun run typecheck`, `bun test`, `bun run check` pass.

## Acceptance criteria

- [x] Each agent class exposes `attributionLabel()` returning the
  documented string for known model IDs, raw string for unknown
  IDs, and `<cli-name> (default model)` when no model is configured.
- [x] `EnsureDraftPrOpts` has a required `attribution: string` field.
- [x] When `ensureDraftPr` creates a new draft PR with a non-empty
  `attribution`, the body submitted to `gh pr create` ends with a
  blank line, `---`, a blank line, and the attribution string.
- [x] When `attribution` is `""`, the body is unchanged (no
  separator, no footer).
- [x] When `ensureDraftPr` finds an existing PR, no body update is
  attempted regardless of `attribution`.
- [x] Patch-mode draft PRs created end-to-end include a footer in the
  form `Written by <label> through Jarvis.` reflecting the agent
  and configured model.
- [x] `bun run typecheck`, `bun test`, `bun run check` all pass.

## Documentation updates

- `AGENTS.md`: under conventions or a new "PR attribution" subsection,
  document that Jarvis appends a one-line attribution footer to draft
  PR bodies and that it is stamped by the harness, not by the agent.
- `docs/agents.md`: note the `attributionLabel()` contract on the
  `Agent` interface and the per-agent fallback when no model is
  configured.
