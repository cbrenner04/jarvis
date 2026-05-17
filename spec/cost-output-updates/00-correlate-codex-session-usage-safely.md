# 00 - Correlate Codex Session Usage Safely

## Problem

Codex usage currently comes from `~/.codex/sessions/**/*.jsonl` by snapshotting the newest session mtime before `codex exec` and choosing the newest file written after the invocation. This can select the wrong file when another Codex session is active in the same checkout or when multiple Jarvis processes invoke Codex near the same time.

Wrong usage is worse than missing usage: it can make the run summary charge one Jarvis run for another Codex conversation. This subspec tightens Codex session-file correlation so Jarvis records usage only when it can identify the session file for the invocation it just ran.

## Decisions

- Prefer `usage_source: "unavailable"` over guessing. If Jarvis cannot uniquely identify the matching Codex session file, the iteration succeeds with `usage = null`, `cost_usd = null`, `cost_source = "no-usage"`, and a warning that explains the ambiguity.
- Replace mtime-only discovery with an invocation-scoped candidate set:
  - Before running Codex, record the set of existing session JSONL paths plus their size and mtime.
  - After Codex exits, list files that are new or changed since the snapshot.
  - Parse only those candidate files.
- Add a correlation step that scores candidate files against the invocation:
  - The session file must contain a Codex user prompt matching the prompt Jarvis sent, or another stable session event that identifies the same prompt. Matching should use the full prompt or a deterministic hash/sentinel of the prompt, not just cwd.
  - The session file should match the requested agent cwd when the JSONL contains cwd metadata.
  - The session file should contain token-count events if usage will be recorded.
- If exactly one candidate matches the invocation, use it.
- If zero candidates match, record unavailable usage with one warning.
- If multiple candidates match, record unavailable usage with one warning naming the candidate paths. Do not choose newest in this case.
- Keep session files read-only. Do not move, truncate, or copy Codex-owned session data.
- Preserve existing parse behavior for a uniquely correlated file: malformed non-usage lines remain non-fatal, token totals come from the final cumulative token-count event, and missing price entries produce `cost_source: "no-price"`.
- Keep the public helper small and testable. A good shape is a single `resolveCodexSessionUsage({ sessionsDir, beforeSnapshot, prompt, cwd })` helper that returns `{ usage, warnings, sessionFile }`, with lower-level snapshot and parser helpers exported only where tests need them.

## Tasks

- [ ] Update `src/agents/codex-session.ts` to expose a snapshot type that records path, mtime, and size for all session JSONL files.
- [ ] Add candidate detection that returns files created or changed after the snapshot, not every file newer than the previous maximum mtime.
- [ ] Add prompt-based correlation for Codex session JSONL files using the actual prompt Jarvis sent or a deterministic prompt sentinel/hash that is visible in the session file.
- [ ] Add cwd-aware correlation when the Codex session JSONL contains cwd metadata.
- [ ] Change ambiguous multi-match behavior from "use newest" to "record unavailable usage with a warning".
- [ ] Update `src/agents/codex.ts` to use the new invocation-scoped resolver and to emit at most one ambiguity warning per invocation.
- [ ] Add or update Codex session fixtures covering a matching prompt, a non-matching prompt from another session, and two matching candidates.
- [ ] Add unit tests for new/changed candidate detection, zero-match behavior, unique-match behavior, and multi-match ambiguity.
- [ ] Add an agent-level regression test showing that concurrent unrelated Codex session files do not get charged to the current invocation.

## Acceptance criteria

- [ ] Jarvis records Codex usage only when exactly one session file correlates to the prompt for the Codex invocation it just ran.
- [ ] If an interactive Codex session in the same repository writes a session file during `jarvis run`, Jarvis does not attribute that unrelated file's usage to the Jarvis iteration.
- [ ] If two Jarvis Codex invocations produce indistinguishable candidate files, the affected iteration records unavailable usage instead of choosing the newest file.
- [ ] Existing valid Codex session fixtures still produce the same token totals and computed cost as before.
- [ ] Codex ambiguity warnings are persisted on the telemetry record so the summary can report them.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.

## Documentation updates

- Update `docs/agents.md` to describe Codex usage as "correlated from session JSONL" and state that ambiguous sessions are treated as unavailable usage.
- Update the cost or run-loop documentation to note that Jarvis intentionally drops ambiguous Codex usage rather than guessing.
