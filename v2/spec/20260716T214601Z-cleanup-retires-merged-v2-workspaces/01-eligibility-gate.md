# 01 - Eligibility gate

## Problem

This is the safety core, and the reason the whole spec has been rejected four times. Given a
discovered worktree candidate, decide whether it is safe to retire: its PR must be **merged**, and no
**non-terminal durable run** and no **daemon-reported live run** may reference it. Getting this wrong
deletes an operator's in-flight work.

**Autopsy of the four rejections — all self-certifying tests:**

- #1672: `gh pr view --head <branch>` — `--head` is a `gh pr list` flag, invalid for `pr view`. Every
  call threw → caught → always ineligible → permanent no-op. A stub matching command name `"gh"`
  answered `MERGED` without inspecting argv.
- #1675: daemon-down `catch { return [] }` read as "no runs" → **fail-open**.
- #1682: guards existed only as high-level injectable predicates; the production CLI passed
  `() => []` / `() => false`, so the daemon was never contacted. No test executed a real `gh` argv.
- #1686: `gh pr list --head <branch>` with **no `--state`** — `gh pr list` defaults to `--state open`,
  so a *merged* PR returns `[]` → ineligible → no-op. And the daemon was injected as pre-fetched
  `DaemonListRunRow[]` data with `cli.ts` swallowing connect failures to `null` → fail-open again.
  Tests hard-coded the mock to answer `MERGED` regardless of argv, so argv assertions still passed.

**The lever this subspec is built on: differential tests.** A test that only checks "removing a guard
turns something red" is self-graded and a permissive mock satisfies its letter. A test that must
produce **opposite outcomes from the same mock on different realistic inputs** cannot be faked — it
forces the production code to actually distinguish the cases.

## Decisions

- The gate is a pure function taking the candidate plus the injectable `AsyncSubprocessRunner`
  (`shared/subprocess.ts`, default `realAsyncSubprocessRunner`) and an injectable daemon **client**
  (a connect/query function, not pre-fetched data) plus the durable run store; returns
  `eligible` or an ineligibility reason. Rules out #1682's high-level predicate injection and
  #1686's pre-fetched daemon data.
- Every `gh`/`git` call routes through the injected runner, including the merged-PR check; rules out
  a direct `realAsyncSubprocessRunner` call that tests inject past.
- Merged detection reads the PR's real state with a command that can see merged PRs — `gh pr view
  <branch> --json state,mergedAt` (or `gh pr list --head <branch> --state merged`), never a bare
  `gh pr list --head` that only sees open PRs; rules out #1686.
- Fail **closed**: if the runner errors, the daemon client throws/cannot connect, or the run store is
  unreadable, the candidate is **ineligible** — never an empty result read as permission; rules out
  #1675/#1686 fail-open.

## Acceptance criteria

- [x] **Differential merged-vs-open.** One test drives the gate with a single mock `AsyncSubprocessRunner`
  that answers `gh` from the actual argv it receives — returning a *merged* state for branch A and an
  *open/unmerged* state for branch B (it does **not** hard-code one answer). The gate returns eligible
  for A and ineligible for B. A stub answering `MERGED` regardless would make both eligible and fail;
  a bare `gh pr list --head` seeing only open PRs would make both ineligible and fail.
- [x] **Differential daemon-reachable-vs-unreachable.** With merged branch A: a daemon client that
  resolves reporting no live run → eligible; a daemon client that throws / cannot connect →
  ineligible. Same candidate, opposite outcomes. The eligible case asserts the client was invoked.
- [x] **Differential durable-run.** With merged branch A: a run store reporting a non-terminal run
  referencing A → ineligible; the same store reporting only terminal runs → eligible.
- [x] The exact merged-detection argv is asserted, and it carries a filter that includes merged PRs.
  Reverting it to `gh pr view --head <branch>` or a stateless `gh pr list --head <branch>` turns a
  test red.
- [x] `bun run check`, `bun run typecheck`, and `bun run test:v2` pass.

## Documentation updates

- [x] `v2/docs/operator-runbook.md` § Recovery/Cleanup: eligibility gate — state the eligibility guarantees (merged PR
  required; unreachable daemon or gh failure ⇒ ineligible).
