# 05 — Codex usage from session JSONL

## Problem

Unlike Claude, `codex exec` does not emit token usage to stdout in any
format we can flip on with a flag. It does, however, write a session JSONL
file under `~/.codex/sessions/` (path varies by version) containing the
event stream — including token-usage events.

This subspec extracts per-iteration usage by locating the session file
that the most recent `codex exec` invocation wrote, parsing the JSONL,
summing token counts, and threading them into the per-iteration telemetry
record. Stdout reformatting is not needed; codex output stays as-is.

## Decisions

- **No CLI flag changes.** Codex argv stays exactly as documented in
  `docs/agents.md`. We do not pass new flags, and we do not change the
  permission posture or sandbox.
- **Session-file discovery strategy.** Before each `codex exec`
  invocation, snapshot the mtime of the most recent file under
  `~/.codex/sessions/` (or the equivalent). After the invocation
  returns, find the session file whose mtime is newer than the
  snapshot. If exactly one new file exists, that's the session file. If
  zero new files exist, log a `harness` warning and record `usage =
  null`. If more than one new file exists, take the newest by mtime and
  log a warning naming both files (this should be rare; concurrent
  codex invocations are not a normal jarvis pattern).
- **Verify session-file location and shape first.** Codex has changed
  its session storage path between versions. The first task in this
  subspec runs `codex exec` against a trivial prompt locally, finds the
  session file it wrote, and records under `## Verified session
  storage`:
  - The exact directory path (and how to derive it portably; do not
    hardcode `~/.codex/sessions` if codex exposes a `codex sessions
    path` or similar command).
  - The file naming convention.
  - The JSONL event types that contain token counts and the exact field
    names used.
  - At least one captured sample file (committed under
    `test/fixtures/codex/`).
- **Token-count summation.** Sum the input/output (and cache, if
  present) token counts across all `usage`-bearing events in the
  session file. If codex emits running totals rather than per-event
  deltas, take the maximum (= final total). The verification step must
  determine which is the case.
- **Cost source.** Codex does not emit a dollar figure; cost is always
  `cost_source: "computed"` via `src/prices/cost.ts`. If the model
  string is missing from the price table, `cost_source: "no-price"`.
- **Failure modes are non-fatal.** Any of these record `usage = null`
  with a single harness warning and otherwise let the iteration succeed:
  - Session file not found.
  - Session file unreadable (permissions, race with codex still
    flushing).
  - JSONL parse error on any line (skip the bad lines; only fall back
    to `null` if no usage events parse at all).
  - The session-file directory itself does not exist (e.g. fresh
    install before codex has written its first session).
- **No retention.** We do not copy or move the session file. Codex owns
  its lifecycle. We open it read-only, sum, and close.
- **`AgentResult` extension reused.** Use the same optional `usage` /
  `cost_usd` / `cost_source` fields on `kind: "ok"` that subspec 04
  added. If subspec 04 has not yet landed, this subspec adds them with
  the same shape and subspec 04 reuses them.

## Tasks

- [ ] **Verify first.** Run `codex exec --color never --sandbox
      workspace-write -c approval_policy="on-request"` against a
      trivial prompt (e.g. "echo hello"). Locate the session file and
      record under `## Verified session storage`:
      - Directory path and how to derive it (env var? hardcoded? from
        `codex` itself?).
      - File naming convention.
      - JSONL event shape: which event `type` carries token counts,
        what the field names are, whether counts are deltas or running
        totals.
      - Any other relevant per-version differences observed.
- [ ] Capture a sample session file under `test/fixtures/codex/<version>-
      simple.jsonl`. Sanitize any user-identifying data (paths,
      session IDs) before committing.
- [ ] Create `src/agents/codex-session.ts` exporting:
      - `findCodexSessionFile(opts: { sessionsDir: string;
        snapshotMtime: number | null }): string | null`
      - `parseCodexSessionUsage(filePath: string): { usage:
        TelemetryUsage | null; warnings: string[] }`
      - `getCodexSessionsDir(): string` — wraps the verified discovery
        mechanism (env var, hardcoded `~/.codex/sessions`, etc.).
- [ ] Update `src/agents/codex.ts` to:
      - Snapshot the most recent mtime under the sessions directory
        before invoking `runAgent`.
      - After `runAgent` returns successfully, call
        `findCodexSessionFile` and `parseCodexSessionUsage`.
      - Attach the resulting `usage` and warnings to the `AgentResult`
        (`kind: "ok"` variant) using the shape from subspec 04. Compute
        cost via `src/prices/cost.ts` here, or pass through and let
        the harness compute — pick whichever subspec 04 settled on for
        Claude and mirror it. (If 04 has not landed, the harness
        computes; codex sets `cost_source` to `"computed"` and
        `cost_usd` to the computed value.)
      - On any failure path, record `usage = null` and emit one
        warning string.
- [ ] Update `src/modes/patch/run.ts` to thread codex `usage` into the
      telemetry record (the same plumbing subspec 04 introduces).
- [ ] Add `test/codex-session.test.ts` covering:
      - `parseCodexSessionUsage` happy path against the captured
        fixture.
      - Returns `null` and warning when file not found.
      - Returns `null` and warning when file is unreadable.
      - Recovers from individual malformed JSONL lines (other lines
        still parse).
      - Sums (or takes max — per verification) correctly across
        multiple usage events.
      - `findCodexSessionFile` returns the new file when one new file
        exists, returns the newest with a warning when multiple new
        files exist, returns `null` when no new files exist.
- [ ] Add `test/codex-agent.test.ts` (or extend) covering: codex agent
      attaches `usage` and `cost_*` fields on success, omits them on
      failure paths, and forwards warnings.

## Acceptance criteria

- [ ] A real `codex exec` invocation through the harness produces a
      telemetry record with non-null `usage` (verified by running the
      harness against a trivial spec — described in the task list, not
      automated).
- [x] Session-file discovery, parsing, and summation are isolated in
      `src/agents/codex-session.ts` and unit-tested against the
      committed fixture.
- [x] Failure modes (no file, unreadable, malformed) are non-fatal:
      iteration proceeds, telemetry records `usage = null`, one
      harness warning is emitted.
- [x] `## Verified session storage` section is populated.
- [x] `bun run typecheck` passes.
- [x] `bun test` passes (including the new tests).
- [x] `bun run check` passes.

## Documentation updates

- [ ] Update `docs/agents.md`'s Codex row to note that usage is
      extracted from the session JSONL file post-invocation.
- [ ] Update `docs/cost.md` (or equivalent) to mark codex as a "real
      usage, computed cost" agent.

## Verified session storage

**Directory path:** `~/.codex/sessions/` (hardcoded; no env var or config command available)

**Directory structure:** Sessions are organized by date: `YYYY/MM/DD/` subdirectories

**File naming convention:** `rollout-YYYY-MM-DDTHH-MM-SS-<uuid>.jsonl`
- Timestamp format: ISO 8601 with hyphens instead of colons (e.g., `2026-05-11T13-20-18`)
- UUID is a 36-character string with dashes

**JSONL event structure:** The session file is a line-delimited JSON file with events. Token usage appears in `event_msg` events:
- Event type: `event_msg` with `payload.type === "token_count"`
- Field path: `payload.info.total_token_usage`
- Fields within token usage:
  - `input_tokens`: number
  - `cached_input_tokens`: number (cache hits; may be 0)
  - `output_tokens`: number
  - `reasoning_output_tokens`: number (may be 0 for non-reasoning models)
  - `total_tokens`: number (sum of inputs and outputs)
- The `total_token_usage` field contains cumulative/running totals (take the final event's values)
- Each event also has `payload.info.last_token_usage` with the delta from the previous response
- Codex version: 0.130.0

**Token count strategy:** Extract the final `token_count` event from the session file (or sum deltas if needed) to get total usage. The `total_token_usage` field has cumulative values, so taking the maximum/final value gives the complete count.

**Fixture location:** `test/fixtures/codex/0.130.0-session.jsonl` — captured from a real codex agent run

## Blocker

Unable to complete the remaining acceptance criterion ("A real `codex exec` invocation through the harness produces a telemetry record with non-null `usage`") in this execution environment.

Concrete failures observed on May 16, 2026:

- `jarvis run` fails preflight with:
  - `jarvis: log server unreachable at http://127.0.0.1:4310/logs. Start it with \`jarvis log-server\` or update config.`
- Attempting to start a local server in isolated temp HOME configs on multiple ports (`4310`, `4311`) fails with:
  - `jarvis: log server failed: Failed to start server. Is port <port> in use?`

Because patch-mode run preflight hard-requires a reachable log server, I cannot run the required real harness verification step from this sandbox despite Codex CLI being available (`codex-cli 0.130.0`).
