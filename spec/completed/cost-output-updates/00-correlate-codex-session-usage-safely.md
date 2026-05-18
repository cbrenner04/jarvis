# 00 - Correlate Codex Session Usage Safely

## Problem

Codex usage currently comes from `~/.codex/sessions/**/*.jsonl` by snapshotting the newest session mtime before `codex exec` and choosing the newest file written after the invocation. This can select the wrong file when another Codex session is active in the same checkout or when multiple Jarvis processes invoke Codex near the same time.

Wrong usage is worse than missing usage: it can make the run summary charge one Jarvis run for another Codex conversation. This subspec tightens Codex session-file correlation so Jarvis records usage only when it can identify the session file for the invocation it just ran.

## Decisions

- Prefer missing usage over guessed usage. If Jarvis cannot uniquely identify the matching Codex session file, the agent invocation still succeeds, but telemetry records `usage_source: "unavailable"`, no `usage`, `cost_usd = null`, `cost_source = "no-usage"`, and one warning that explains why usage was dropped.
- Add a unique invocation marker to each Jarvis Codex prompt before invoking `codex exec`.
  - The marker must be unique per Codex invocation, not deterministic from the prompt or cwd. A random UUID or equivalent invocation id is acceptable.
  - The marker should be low-impact agent-facing text, such as an HTML comment at the end of the prompt: `<!-- jarvis-codex-invocation: <id> -->`.
  - The marker is only for correlation. It must not change Jarvis task selection, spec completion behavior, or log redaction behavior.
- Replace mtime-only discovery with an invocation-scoped candidate set:
  - Immediately before running Codex, record the set of existing session JSONL paths plus each file's size and mtime.
  - After Codex exits, list files that are new or whose size or mtime differs from the snapshot.
  - Parse only those candidate files.
- Correlate candidates with hard filters rather than "newest wins":
  - The session file must contain the invocation marker in a structured prompt/input event. Use raw whole-file substring matching only as a documented compatibility fallback for known Codex JSONL shapes that do not expose prompt text in a stable field.
  - If the session file contains cwd metadata, it must match the cwd Jarvis passed to the Codex agent.
  - The session file must contain token-count events before usage can be recorded.
- If exactly one candidate matches the invocation, use it.
- If zero candidates match, record unavailable usage with one warning.
- If multiple candidates match, record unavailable usage with one warning naming the candidate paths. Do not choose newest in this case, and do not print the old `multiple codex session files detected; using newest` message.
- Keep session files read-only. Do not move, truncate, or copy Codex-owned session data.
- Preserve existing parse behavior for a uniquely correlated file: malformed non-usage lines remain non-fatal, token totals come from the final cumulative token-count event, and missing price entries produce `cost_source: "no-price"`.
- Keep the public helper small and testable. A good shape is a single `resolveCodexSessionUsage({ sessionsDir, beforeSnapshot, invocationMarker, cwd })` helper that returns `{ usage, warnings, sessionFile }`, with lower-level snapshot and parser helpers exported only where tests need them. The return value must distinguish "no correlated session" from "correlated session with parse warnings" so caller telemetry can preserve warnings without treating all warnings as successful usage.

## Tasks

- [ ] Update `src/agents/codex-session.ts` to expose a snapshot type that records path, mtime, and size for all session JSONL files.
- [ ] Add candidate detection that returns files created or changed compared with the snapshot, not every file newer than the previous maximum mtime.
- [ ] Add per-invocation marker generation in `src/agents/codex.ts` and append the marker to the prompt passed to `codex exec`.
- [ ] Add marker-based correlation for Codex session JSONL files by parsing structured JSONL events first, with any raw substring fallback isolated and covered by tests.
- [ ] Add cwd-aware correlation when the Codex session JSONL contains cwd metadata, while still allowing files from older Codex versions that omit cwd metadata.
- [ ] Change ambiguous multi-match behavior from "use newest" to "record unavailable usage with a warning".
- [ ] Update `src/agents/codex.ts` to use the new invocation-scoped resolver and to emit at most one missing or ambiguous session warning per invocation, with no "using newest" fallback wording.
- [ ] Add or update Codex session fixtures covering a matching marker, a non-matching marker from another session, omitted cwd metadata, mismatched cwd metadata, and two matching candidates.
- [ ] Add unit tests for new/changed candidate detection, zero-match behavior, unique-match behavior, and multi-match ambiguity.
- [ ] Add an agent-level regression test showing that concurrent unrelated Codex session files do not get charged to the current invocation.

## Acceptance criteria

- [x] Jarvis records Codex usage only when exactly one changed session file correlates to the unique invocation marker for the Codex invocation it just ran.
- [x] If an interactive Codex session in the same repository writes a session file during `jarvis run`, Jarvis does not attribute that unrelated file's usage to the Jarvis iteration.
- [x] If more than one candidate file contains the same invocation marker, the affected iteration records unavailable usage instead of choosing the newest file.
- [x] Ambiguous or missing Codex usage does not print `multiple codex session files detected; using newest`.
- [x] Existing valid Codex session fixtures still produce the same token totals and computed cost as before.
- [x] Codex ambiguity warnings are persisted on the telemetry record so the summary can report them.
- [x] `bun run typecheck` passes.
- [x] `bun test` passes.

## Documentation updates

- Update `docs/agents.md` to describe Codex usage as "correlated from session JSONL" and state that ambiguous sessions are treated as unavailable usage.
- Update the cost or run-loop documentation to note that Jarvis adds a per-invocation Codex marker and intentionally drops ambiguous Codex usage rather than guessing.
