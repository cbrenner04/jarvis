# Trailer-sourced attribution footer

Replace the static single-line attribution that `ensureDraftPr`
appends with a footer rendered from `Jarvis-Agent` git trailers on the
PR branch. The footer carries a per-commit list and a deduped summary
line.

## Context

Subspec 00 stamps `Jarvis-Agent: <label>` trailers on every commit
jarvis creates. This subspec consumes those trailers and renders the
footer that the body builder (subspec 01) and update path (subspec
03) will compose into the PR body.

Today, attribution lives in `src/pr.ts` (`ensureDraftPr`), where a
single `attribution: string` opt is appended after `---`. The string
is built at the call site in `src/modes/patch/run.ts` from the active
agent's `attributionLabel()`.

## Decisions

- **Source.** Read commits on the PR branch ahead of the base via
  `git log --format=<format> <base>..HEAD`. Use a format string that
  yields the short SHA, the subject, the first body line, and the
  trailer block — for example
  `--format=%h%x00%s%x00%(trailers:key=Jarvis-Agent,valueonly=true,separator=%x1f)%x00%b%x1e`
  with NUL/RS separators for robust parsing. (Implementation may
  prefer a series of simpler `git log` calls; the contract is the
  data, not the format string.)
- **Subspec-commit filter.** Render only commits whose first body
  line starts with `Spec: ` (matching `commitSubspec`'s body shape).
  WIP commits are excluded from the per-commit list even though they
  carry trailers; their inclusion would churn the footer between
  subspec landings and is out of scope.
- **Per-commit list rendering.** Chronological (oldest first), one
  bullet per matching commit:

  ```
  - <short sha> <commit subject> — <agent label>
  ```

  The em-dash separator is `—` (U+2014). When a commit has no
  `Jarvis-Agent` trailer, the label is the literal string `unknown`.
  When a commit has more than one `Jarvis-Agent` trailer (should not
  happen but is technically possible), join values with `, `.
- **Summary line rendering.** Built from the per-commit labels:
  - Drop `unknown`.
  - Dedupe preserving first-appearance order.
  - If two or more unique labels remain:
    `Written by <A>, <B>, <C> through Jarvis.`
  - If exactly one unique label remains: `Written by <A> through
    Jarvis.` (matches today's format).
  - If zero labels remain (all commits are pre-upgrade or label-less),
    omit the summary line entirely.
- **Footer assembly.** A new function in `src/pr.ts` (or a new
  `src/modes/patch/attribution.ts`):

  ```ts
  export function renderAttribution(opts: {
    cwd: string;
    base: string;
  }): string;
  ```

  Returns the assembled footer text — the per-commit list (each
  bullet on its own line), a blank line, the summary line. Returns
  `""` when there are no subspec commits at all (empty branch state).
- **Composition.** `ensureDraftPr` and the new update path (subspec
  03) both compose the body as: `<header+narrative>\n\n---\n\n<footer>`
  when the footer is non-empty, otherwise just `<header+narrative>`.
  This preserves the existing `---` separator behavior.
- **Backward compat.** PRs with pre-upgrade commits will see those
  commits rendered with `unknown` in the per-commit list. The summary
  line will reflect only labelled commits, which heals naturally as
  new subspecs land.

## Task Checklist

- [ ] Implement `renderAttribution({ cwd, base })` in `src/pr.ts` (or
      a new `src/modes/patch/attribution.ts`, whichever keeps the
      module graph clean — `src/pr.ts` is fine since `ensureDraftPr`
      already lives there).
- [ ] Implement a small helper that runs `git log` with the chosen
      format and parses out `{ shortSha, subject, firstBodyLine,
      jarvisAgentTrailers[] }` per commit. Filter to subspec commits
      (`Spec: ` first body line).
- [ ] Implement label dedup + summary-line builder per the rules
      above.
- [ ] Update `ensureDraftPr` to accept the footer instead of (or in
      addition to) the existing `attribution: string`. Recommended:
      replace `attribution: string` with `footer: string`, where
      callers compute `footer` via `renderAttribution`. Empty footer
      → no `---` separator and no footer text appended.
- [ ] Update the call site in `src/modes/patch/run.ts` for the
      first-create path to call `renderAttribution` and pass `footer`.
- [ ] Add unit tests in `tests/` exercising: zero commits, one
      labelled commit, multiple commits same label, multiple commits
      multiple labels (interleaved), commits without trailers
      (unknown handling), WIP commits filtered out, multi-trailer
      commit, and the summary-line collapse rules.

## Acceptance criteria

- [x] `renderAttribution` returns `""` when there are no subspec
      commits on the branch.
- [x] When all subspec commits carry the same `Jarvis-Agent` label,
      the summary line collapses to `Written by <Label> through
      Jarvis.` (matches today's format).
- [x] When subspec commits carry multiple distinct labels, the
      summary lists them in first-appearance order, deduped,
      comma-separated, ending with ` through Jarvis.`.
- [x] Per-commit list bullets follow `- <short sha> <subject> —
      <label>` format, with `unknown` for commits missing the
      trailer.
- [x] WIP commits are not included in the per-commit list even if
      they carry trailers.
- [x] `ensureDraftPr` composes the body with `\n\n---\n\n<footer>`
      when the footer is non-empty, and no separator otherwise.
- [x] `bun run typecheck`, `bun test`, and `bun run check` all pass.

## Documentation updates

- [x] Update `README.md` PR body / attribution section: replace the
      "single attribution footer" description with the per-commit
      list + summary line shape, and reference `Jarvis-Agent`
      trailers.
- [x] Update `AGENTS.md` "PR attribution" section: replace the
      single-line format with the new per-commit-list-plus-summary
      format and document trailer-sourced rendering.
- [x] Update `docs/worktrees-and-commits.md` PR body section (added in
      subspec 01) with the footer composition rules.
