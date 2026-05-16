# 07 — Cursor usage

## Problem

Cursor's headless agent mode (`cursor agent -p`) has historically been the
most opaque of the four CLIs. There is no documented JSON output flag that
includes token usage, no documented session-file path, and Cursor's own
public docs talk about "requests" rather than per-token rates.

This subspec establishes whether token usage can be extracted from cursor
at all, and if not, makes the `usage_source: "unavailable"` outcome
explicit and documented rather than implicit.

## Decisions

- **Investigate first, same shape as subspec 06.** Run `cursor agent
  --help` and `cursor agent -p --help`, scan Cursor's docs (the public
  ones at `docs.cursor.com` and any `cursor` bundled help), and look
  for any of: JSON output, structured stdout/stderr, session files,
  telemetry endpoints. Record findings under `## Verified cursor
  capabilities`.
- **`unavailable` is the expected outcome.** This subspec is written
  with the strong prior that no extraction path exists. If one does, we
  pivot to implementing it (mirroring whichever subspec 04/05/06
  pattern fits). If not, we ship the unavailable path and move on.
- **No CLI flag changes without justification.** Same rule as subspec
  06.
- **Reuse the agent-result extension** introduced by subspecs 04/05/06.
  No new types.

## Tasks

- [ ] **Investigate first.** Capture `cursor agent --help` and
      `cursor agent -p --help` output under `## Verified cursor
      capabilities` in this file. Note any flags or behaviors related
      to JSON, logging, telemetry, usage, or cost.
- [ ] Check cursor's data directories (`~/.cursor/`, `~/Library/
      Application Support/Cursor/`, `~/.config/cursor/`, etc.) for
      session files written during a `cursor agent -p` invocation.
- [ ] Record findings and a recommended path under `## Verified cursor
      capabilities`.
- [ ] **Implement the chosen path.** Either:
      - **(a) Extraction path** (unlikely): mirror the relevant
        subspec 04/05/06 pattern.
      - **(b) Unavailable path** (expected): in `src/agents/cursor.ts`,
        attach `usage = null` and `usage_source = "unavailable"` to
        every successful `AgentResult`. Add a one-time harness notice
        the first time cursor runs per `jarvis run`:
        `cursor: token usage not available for this CLI version
        (recording usage as unavailable)`.
- [ ] Add or extend `test/cursor-agent.test.ts` to assert that cursor
      iterations attach `usage_source: "unavailable"` (or, if path (a)
      was chosen, that real usage is attached and failure modes are
      non-fatal).

## Acceptance criteria

- [ ] `## Verified cursor capabilities` section in this file is
      populated.
- [ ] Either: cursor iterations record real `usage`, OR cursor
      iterations record `usage = null` with `usage_source:
      "unavailable"` and a one-time harness notice is printed per
      `jarvis run`.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes (including the new tests).
- [ ] `bun run check` passes.

## Documentation updates

- [ ] Update `docs/agents.md`'s Cursor row with the chosen strategy.
- [ ] Update `docs/cost.md` (or equivalent) with cursor's cost
      attribution status.

## Verified cursor capabilities

_To be filled in by the implementer during the investigation task above._
