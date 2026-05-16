# 08 — Quota pattern audit (opportunistic)

## Problem

`src/agents/quota.ts` contains regexes for vendor quota messages
(`claude`, `codex`, `cursor`, `opencode`). Vendors reword these messages
over time. The current patterns are best-guess at the time they were
written; nothing keeps them honest. A pattern that no longer matches
turns a real quota error into a hard exit 3, which subspec 07 only
partially mitigates.

This subspec does not exhaust accounts to collect strings (cost we don't
want to pay). It is an opportunistic capture: each time the operator
encounters a real quota event during normal use, the stderr is recorded
verbatim and added to a docs file. The subspec also adds the tooling to
make this easy.

## Behavior

- Add `docs/quota-signals.md` (already exists) sections per agent for
  "Observed quota stderr (real samples)" with timestamped entries.
- Add a small CLI helper (or a doc-only convention; both acceptable) for
  appending a captured stderr block with date and agent. Doc-only is
  fine — the goal is a low-friction recording habit, not new code.
- Audit current patterns: for each pattern in `quota.ts`, link to either
  (a) a captured sample in `docs/quota-signals.md` that the pattern
  matches, or (b) a note that no sample is available yet.
- Patterns without a sample stay in place (they may still be correct) but
  are marked as unverified.
- Update `docs/quota-signals.md` with the audit results and clear
  conventions for adding future samples.

This subspec does not modify regex behavior. Regex changes (if any) come
in follow-ups once samples are in hand.

## Tasks

- [ ] Walk every pattern in `src/agents/quota.ts` and write a note in
      `docs/quota-signals.md` linking it to a sample or marking unverified.
- [ ] Document the "how to capture and record a quota event" convention
      in `docs/quota-signals.md`.
- [ ] If any pattern is clearly broken (e.g. matches generic 429 text
      that we now know is unrelated), record a follow-up TODO in the doc
      rather than changing the regex in this subspec.

## Acceptance criteria

- [x] Every pattern in `quota.ts` has a corresponding entry in
      `docs/quota-signals.md` (sample link or "unverified" note).
- [x] `docs/quota-signals.md` documents the convention for adding new
      captured samples.
- [x] `bun run typecheck` passes.
- [x] `bun test` passes.

## Documentation updates

- `docs/quota-signals.md`: full audit results + capture convention.
