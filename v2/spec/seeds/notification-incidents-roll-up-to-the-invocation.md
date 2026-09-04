---
name: notification-incidents-roll-up-to-the-invocation
---

# Terminal notifications fire per run row, so the sink is chatty and silent in the wrong places

## Problem

`run-ad-hoc-terminal` derives one incident per terminal **run row**. A single standalone workflow settles several rows — entry, write, review, shrink, publication — so an operator watching the sink gets a `terminal:completed` while the workflow is still running, then several more, none of which mean the work finished. Every one costs a `run list --branch` round trip to interpret, which is the polling the sink exists to replace.

The complement is worse: the states an operator most needs to be woken for are not terminal, so they emit nothing at all. A run that settles `paused` produces no incident. So the sink is loud about non-events and silent about the one that strands work.

## Evidence

Observed 2026-09-04 across a full operator session driving the notification chain. Every `terminal:completed` incident on branch `20260903T181000Z-notification-ledger-persists-delivered-incidents` — four of them, run ids `1ccff9b9`, `aefd9ba8`, `240cc32e`, `58e82446` — arrived while the workflow was still live, each followed by a new successor row. Each required checking `jarvis run list --branch` to learn the workflow had not finished, so the sink added a step rather than removing one.

In the same session, run `7475c190` settled `missing_blocker` → `paused` holding a completed, committed subspec. **No incident fired**, because `paused` is not terminal. The stall was found only by manually listing the branch.

Recorded as a known gap on 2026-09-01 ("one incident per terminal workflow run row is chatty for multi-row invocations"; "`run-ad-hoc-terminal` fires on a multi-step workflow's *entry* run terminal, before its review step settles") and left un-filed as a candidate. It has now cost operator attention in a second session, and the pull-side surfaces (`notifications wait|list`) inherit whatever this derivation emits — a wake primitive built on per-row incidents wakes on the same non-events.

## Decisions

- A workflow invocation emits one terminal incident, when the invocation itself reaches a terminal state — not one per constituent run row. Rules out entry-row and successor-row terminals each producing an operator-visible incident.
- Ad-hoc runs with no invocation keep today's per-run terminal incident. Rules out suppressing the standalone case that the current shape serves correctly.
- `paused` and other non-terminal states that require operator action to clear emit their own incident kind. Rules out defining operator-actionable purely as durable terminality.
- The incident carries the invocation's settled outcome, so an operator can act without a follow-up `run list`. Rules out an incident that only names ids.
- Kind filtering on the pull surfaces composes with this rollup, so `notifications wait --kind` selects invocation-level kinds. Rules out a rollup that only changes sink spawning and leaves the ledger per-row.

## Acceptance criteria

- [ ] A new sweep test `multi-row workflow invocation emits one terminal incident` drives an invocation whose entry, write, and review rows all settle and asserts exactly one terminal incident is derived, carrying the invocation outcome; it fails against the pre-fix per-row derivation.
- [ ] A new sweep test `entry row terminal does not emit while successors are live` asserts no terminal incident is derived while any sibling row under the invocation is non-terminal; it fails against the pre-fix entry-terminal emission.
- [ ] A new sweep test `ad-hoc run without an invocation still emits its terminal incident` asserts the standalone path is unchanged; it fails against a rollup that suppresses it.
- [ ] A new sweep test `paused run emits an operator-actionable incident` asserts a run settling `paused` derives an incident; it fails against the pre-fix terminal-only derivation.
- [ ] `bun run typecheck` and the `test:v2` pair pass.

## Documentation updates

- `v2/docs/daemon-host.md` — § Operator notifications: incidents roll up to the invocation; the non-terminal operator-actionable kinds.
- `v2/docs/operator-runbook.md` — § Deciding a workflow is finished: one incident per invocation, so a terminal incident means the workflow finished; drop the guidance to re-check `run list --branch` after a terminal incident.
