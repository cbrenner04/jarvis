# Stamp Jarvis-Agent trailer on every commit

Make every git commit Jarvis creates carry a `Jarvis-Agent: <label>`
trailer so that PR-body attribution can be reconstructed from `git log`
on any branch, across resumes and agent switches.

## Context

Jarvis commits are produced in `src/modes/patch/subspec.ts` by three
helpers:

- `commitSubspec` — the per-subspec commit (subject = subspec H1, body
  starts with `Spec: <relative path>` followed by the
  `## Acceptance criteria` section).
- `commitWipProgress` — `WIP:` commits made when an iteration ticks
  some but not all acceptance criteria.
- `commitWipProgressWithBlocker` — `WIP:` variant that also captures a
  `## Blocker` section.

Each helper assembles a commit message string and pipes it to
`git commit -F -`. None of them currently know which agent ran the
iteration — the agent identity lives in `src/modes/patch/run.ts` at
the call site.

## Decisions

- **Trailer name.** Exactly `Jarvis-Agent`. No alternative spellings
  accepted by the parser; the renderer in subspec 02 will look for
  this exact key.
- **Trailer value.** Exactly `agent.attributionLabel()` for the agent
  that produced the iteration. This is the same string today's
  attribution footer uses.
- **Placement.** Trailers go at the bottom of the commit message,
  separated from the rest of the body by a blank line, in the standard
  git-trailer position so `git log --format='%(trailers)'` and
  `git interpret-trailers` both work. Multiple trailers (jarvis-only
  for now) are one per line.
- **Scope.** All three commit helpers (`commitSubspec`,
  `commitWipProgress`, `commitWipProgressWithBlocker`) gain the
  trailer. Stamping WIP commits is intentional even though the PR
  body only renders subspec commits — it keeps the data shape uniform
  and lets future tooling (telemetry, blame analysis) consume the
  same source.
- **Plumbing.** Each helper takes a new required option
  `agentLabel: string`. Callers in `src/modes/patch/run.ts` pass
  `agent.attributionLabel()`. Type-level requirement (no defaulting)
  prevents the call site from silently dropping the value.
- **Empty label.** If `agentLabel === ""`, the trailer is omitted
  entirely (no `Jarvis-Agent: ` line). This mirrors today's tolerance
  for empty attribution in `ensureDraftPr` and keeps test fixtures
  that mock agents without a configured model working.
- **Idempotence.** The trailer is appended to the message string
  jarvis builds; jarvis does not invoke `git interpret-trailers`. The
  message is only used once (on commit), so duplication is not a
  concern.

## Task Checklist

- [ ] Add `agentLabel: string` to the options of `commitSubspec`,
      `commitWipProgress`, and `commitWipProgressWithBlocker` in
      `src/modes/patch/subspec.ts`.
- [ ] Append `Jarvis-Agent: <label>` to each commit message, separated
      from the preceding body by a blank line. Skip when the label is
      empty.
- [ ] Update every call site in `src/modes/patch/run.ts` to pass
      `agent.attributionLabel()`.
- [ ] Add unit tests in `tests/` covering: trailer present with a
      known label, trailer omitted with empty label, trailer placed
      after `## Acceptance criteria` body, trailer placed after
      `## Blocker` body.
- [ ] Update any existing tests that construct calls to these helpers
      to pass the new option.

## Acceptance criteria

- [x] `commitSubspec`, `commitWipProgress`, and
      `commitWipProgressWithBlocker` require an `agentLabel` option.
- [x] When `agentLabel` is non-empty, the resulting commit message
      ends with a `Jarvis-Agent: <label>` line in the trailer
      position, separated from the body by exactly one blank line.
- [x] When `agentLabel` is empty, the commit message contains no
      `Jarvis-Agent` line.
- [x] All call sites in `src/modes/patch/run.ts` pass
      `agent.attributionLabel()`.
- [x] `bun run typecheck` passes.
- [x] `bun test` passes, including new trailer-coverage tests.
- [x] `bun run check` passes.

## Documentation updates

- [x] In `README.md`, update the "Commit shape" section to mention the
      `Jarvis-Agent` trailer and that it appears on both subspec and
      WIP commits.
- [x] In `docs/worktrees-and-commits.md`, document the trailer (name,
      value source, placement, scope) in the commit-shape section.
