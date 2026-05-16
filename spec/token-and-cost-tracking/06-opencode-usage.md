# 06 — Opencode usage

## Problem

Opencode is a router CLI: `opencode run` dispatches to whichever underlying
provider model is configured (e.g. `github-copilot/claude-opus-4.7`,
`AirProxy/<model>`). We need to extract per-iteration token usage from
opencode invocations the same way subspecs 04 and 05 do for Claude and
Codex.

Unlike those two, **we do not yet know which extraction path opencode
supports**. Possibilities, in rough decreasing-cooperation order:

1. `opencode run --format json` (or similar) emits a structured envelope
   with usage data, like Claude.
2. `opencode run --print-logs` (or similar) emits log lines including
   token counts on stderr.
3. Opencode writes a session file we can read post-invocation, like Codex.
4. None of the above; usage is genuinely unavailable.

This subspec investigates first, then implements whichever option
materializes — or documents `usage_source: "unavailable"` if none does.

## Decisions

- **Investigate before implementing.** The first task is research:
  enumerate `opencode run --help`, scan opencode's documentation, and
  determine which (if any) of the four options above is supported by
  the version this jarvis checkout is meant to work with.
- **No CLI flag changes without justification.** If the investigation
  turns up a usage flag, we evaluate it on the same criteria we used
  for Claude: does it change user-visible terminal output? Is the
  envelope shape stable? Is parse failure non-fatal? Only switch the
  argv if the answers are acceptable; otherwise document the trade-off
  and pick a different option.
- **`unavailable` is an acceptable outcome.** If none of the four
  options yields usable usage data with acceptable trade-offs, this
  subspec lands as: opencode agent emits `usage = null` and
  `usage_source: "unavailable"` for every iteration, with a one-time
  harness notice on first opencode use per `jarvis run`. The
  acceptance criteria below cover both the "wired up" and the
  "explicitly unavailable" outcomes.
- **Provider routing does not change cost lookup.** We look up the
  `model` string the user configured in `agentOrder` (e.g.
  `github-copilot/claude-opus-4.7`) directly in `data/prices.json`. If
  the price table has that exact key, we use those rates. If not,
  `cost_source: "no-price"`. We do **not** try to resolve the routed
  underlying model — that's an opencode internal that the price table
  doesn't need to know about. Subspec 03's `jarvis prices update`
  handles populating `provider/model` keys via models.dev where
  possible; missing entries are a manual edit.
- **Reuse subspec 04's `AgentResult` extension.** Same `usage` /
  `cost_usd` / `cost_source` / `warnings` fields on the `kind: "ok"`
  result. This subspec depends on either subspec 04 or subspec 05
  having landed first to introduce those fields; if neither has
  landed, this subspec adds them with the same shape.

## Tasks

- [ ] **Investigate first.** Run `opencode run --help` and capture the
      full output under a `## Verified opencode capabilities` section
      in this file. Note any flags related to: output format, logging,
      verbosity, JSON, telemetry, usage, cost.
- [ ] If any candidate flag exists, run `opencode run` against a
      trivial prompt with that flag and capture stdout + stderr to a
      fixture under `test/fixtures/opencode/<version>-<scenario>.*`.
- [ ] Check whether opencode writes session files (look under
      `~/.config/opencode/`, `~/.local/share/opencode/`,
      `~/.cache/opencode/`, and any path mentioned in `opencode run
      --help` or opencode docs). If it does, capture a sample session
      file as a fixture.
- [ ] Record findings under `## Verified opencode capabilities` in
      this file: which of the four extraction paths are available,
      their stability, and a recommended approach.
- [ ] **Implement the chosen path.** Either:
      - **(a) JSON / structured stdout path**: add an adapter at
        `src/agents/opencode-json.ts` (or similar), wire `opencode.ts`
        to use the new flag, parse, attach usage to `AgentResult`. If
        the new flag changes user-visible terminal output, follow
        subspec 04's pattern (synthesize `displayText`, add a config
        opt-out at `modes.patch.agents.opencode.outputFormat`).
      - **(b) Stderr log-line path**: parse the existing stderr stream
        for usage lines. Adapter at `src/agents/opencode-stderr.ts`
        with fixture-tested regexes. No CLI flag change.
      - **(c) Session-file path**: mirror subspec 05's discovery and
        parse logic. Adapter at `src/agents/opencode-session.ts`.
      - **(d) Unavailable path**: in `src/agents/opencode.ts`, attach
        `usage = null` and `usage_source = "unavailable"` to every
        successful `AgentResult`. Add a one-time harness notice the
        first time opencode runs per `jarvis run`:
        `opencode: token usage not available for this CLI version
        (recording usage as unavailable)`.
- [ ] Update `src/modes/patch/run.ts` if the chosen path adds new
      fields not already plumbed by subspecs 04/05.
- [ ] Add tests under `test/opencode-*.test.ts` matching the chosen
      path. For paths (a)–(c), test happy path + at least two failure
      modes (parse error, missing data) using committed fixtures. For
      path (d), test that the agent attaches `usage_source:
      "unavailable"` on every success.

## Acceptance criteria

- [ ] `## Verified opencode capabilities` section in this file is
      populated with the captured `--help` output, fixture references,
      and the rationale for the chosen path.
- [ ] Either: opencode iterations record real `usage` in the
      per-iteration telemetry record, OR opencode iterations record
      `usage = null` with `usage_source: "unavailable"` and a one-time
      harness notice is printed per `jarvis run`.
- [ ] Failure modes (if any extraction path was chosen) are non-fatal.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes (including the new tests).
- [ ] `bun run check` passes.

## Documentation updates

- [ ] Update `docs/agents.md`'s Opencode row with the chosen extraction
      strategy or the "usage unavailable" note.
- [ ] Update `docs/cost.md` (or equivalent) with opencode's cost
      attribution status.

## Verified opencode capabilities

_To be filled in by the implementer during the investigation task above._
