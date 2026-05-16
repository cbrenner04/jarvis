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

- [x] **Investigate first.** Capture `cursor agent --help` and
      `cursor agent -p --help` output under `## Verified cursor
      capabilities` in this file. Note any flags or behaviors related
      to JSON, logging, telemetry, usage, or cost.
- [x] Check cursor's data directories (`~/.cursor/`, `~/Library/
      Application Support/Cursor/`, `~/.config/cursor/`, etc.) for
      session files written during a `cursor agent -p` invocation.
- [x] Record findings and a recommended path under `## Verified cursor
      capabilities`.
- [x] **Implement the chosen path.** Either:
      - **(a) Extraction path** (unlikely): mirror the relevant
        subspec 04/05/06 pattern.
      - **(b) Unavailable path** (expected): in `src/agents/cursor.ts`,
        attach `usage = null` and `usage_source = "unavailable"` to
        every successful `AgentResult`. Add a one-time harness notice
        the first time cursor runs per `jarvis run`:
        `cursor: token usage not available for this CLI version
        (recording usage as unavailable)`.
- [x] Add or extend `test/cursor-agent.test.ts` to assert that cursor
      iterations attach `usage_source: "unavailable"` (or, if path (a)
      was chosen, that real usage is attached and failure modes are
      non-fatal).

## Acceptance criteria

- [x] `## Verified cursor capabilities` section in this file is
      populated.
- [x] Either: cursor iterations record real `usage`, OR cursor
      iterations record `usage = null` with `usage_source:
      "unavailable"` and a one-time harness notice is printed per
      `jarvis run`.
- [x] `bun run typecheck` passes.
- [x] `bun test` passes (including the new tests).
- [x] `bun run check` passes.

## Documentation updates

- [x] Update `docs/agents.md`'s Cursor row with the chosen strategy.
- [x] Update `docs/cost.md` (or equivalent) with cursor's cost
      attribution status.

## Verified cursor capabilities

### CLI help output (`cursor agent --help`, `cursor agent -p --help`)

- Both commands currently return the same help text.
- `--output-format` is available with values `text | json | stream-json`, but
  the help only describes transcript formatting and does not document any usage
  or cost fields in JSON output.
- No flag in help text indicates usage/cost reporting, telemetry export, or a
  session-file path for token accounting.

### Docs and runtime checks

- A headless run using `cursor agent -p --output-format json` failed early with
  a local project directory creation error and did not emit any usage payload.
- Local Cursor directories were inspected:
  `~/.cursor/`, `~/Library/Application Support/Cursor/`, and `~/.config/cursor/`.
- `~/.config/cursor/` does not exist on this machine.
- `~/.cursor/` contains CLI state, project metadata, logs, and extension data
  (for example `projects/*/worker.log`, `repo.json`) but no documented
  token-usage session artifact analogous to Codex JSONL usage events.

### Recommended path

- Use path **(b) unavailable** for now:
  successful cursor iterations set `usage_source: "unavailable"` and
  `cost_source: "no-usage"`, and patch mode prints a one-time notice per run:
  `cursor: token usage not available for this CLI version (recording usage as unavailable)`.
