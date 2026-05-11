# 02 — `run.ts` sinks: terminal, session file, server (inbound / outbound)

## Problem

During each iteration users must clearly see **which work** is executing. Agent subprocess output should remain useful (Claude already reasonable; others tuned via `03`). All **log-visible** harness output — including what is printed for the interactive user — **also** persists to **that session’s file under `~/.jarvis/sessions/`** and is **forwarded marked** to the **log server**.

## Decisions

- **Orchestration home**: `commands/run.ts` owns wiring: open session file once per run; build **tagged** records for outbound vs inbound streams; tee to user `stdout`/`stderr` as needed so behavior stays approachable in a naked terminal too.
- **Iteration banner** (required **before each agent invocation** — same placement as today’s iteration line): include at minimum — **registered project key** (`projects` registry name), **spec display name**, **`iteration`** (harness outer-loop counter only), **`current-task`** derived from the spec file (see below). These stay **distinct**: iteration increments every loop lap; task text changes when unchecked items disappear.
  - **Spec display name v1**: `basename(specPath)` unless a clearer relative path proves trivial; document choice.
  - **`iteration`**: `1 … maxIterations` counter already implied by today’s loop; always print explicitly in the banner/logs.
  - **`current-task`** (must appear in banner, session file, and server payload): the **primary unchecked checklist item Jarvis intends the agent to pick next** — v1 approximation = **document-order first line matching `- [ ]`** (`completion.ts`-style semantics, same Markdown dialect as [`countUnchecked`](src/completion.ts)). Include readable **task excerpt** (strip leading checklist marker for display; truncate with documented max length only if noisy). Include **ordinal within unchecked only**: e.g. `1 / N` unchecked where `N` matches `countUnchecked` at banner time (same pass or consistent helper so they cannot disagree).
- **Outbound / inbound**:
  - **Outbound**: content jarvis sends **into** the agent (the built prompt payload from `buildPrompt`/equivalent — full text persists if it prints to logs).
  - **Inbound stdout / inbound stderr**: streams from child process mapped distinctly.
  - Harness-only status lines (“spec complete”, “quota exhausted”) may remain untagged terminal text but **still** replicated to session file/server with an agreed tag (e.g. `jarvis` or `harness`).
- Anything sent to logs is **newline-safe**: either prefix each physical line consistently or serialize structured lines — pick one regime and mirror it server-side + disk.

## Tasks

- [ ] Add a **`completion`-adjacent helper** that returns first unchecked checkbox line + unchecked ordinal/total (`src/completion.ts` or justified split). Reuses the unchecked-line regex semantics; rejects malformed specs consistently with [`countUnchecked`](src/completion.ts).
- [ ] Wire session file `{namespace}-{utc}.log` per `00`; append from start until process exit (`finally`/`try` discipline).
- [ ] Integrate mandatory server client (`01`): same payload as printed/stored tagging.
- [ ] Replace/supplement literal `iteration N — agent:` line so banner shows **iteration** and **current-task summary** distinctly (still include active agent id).
- [ ] Tests: unit tests on the unchecked-task picker for multi-line specs; mocked IO + mocked server sink cover banner fields + outbound preceding inbound on stub agent runs.

## Acceptance criteria

- Every agent iteration emits one human-readable contextual header **before** spawning work, including **iteration** and explicit **what task text** is presumed next (primary unchecked item), not collapsing the two concepts.
- Session file reconstructs chronological session with explicit outbound vs inbound distinctions.
- `bun test` + lint + typecheck.

## Documentation updates

- `README.md`: session file layout semantics; outbound/inbound meaning; banner fields (**iteration vs current-task excerpt**).
