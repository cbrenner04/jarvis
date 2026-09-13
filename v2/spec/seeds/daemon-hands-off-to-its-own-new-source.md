---
name: daemon-hands-off-to-its-own-new-source
---

# A daemon whose source changed hands off to a new generation on its own

## Problem

The handoff protocol exists and works ([#3806](https://github.com/cbrenner04/jarvis/pull/3806), [#3824](https://github.com/cbrenner04/jarvis/pull/3824)): an incoming generation takes the stable public address, the outgoing generation stops admitting new work, drains what it owns, and exits. Nothing ever triggers it.

A daemon loads harness code once, at start. After a merge to `v2/src` the incumbent keeps serving old code indefinitely, because the only caller that would start a generation — `connectWithAutoStart` — calls `startDaemon` solely when nothing is listening, and after the stable-address work something always is. The daemon already computes and reports what it needs to notice: `loadedRevision` and `loadedExecutableDigest` at startup (`v2/src/daemon/daemon.ts:930-937`), and `getDaemonStatus` compares them to the current tree. The single consumer of that comparison does nothing with it:

```ts
if (status.state === "stale") return warn("daemon loaded revision is stale");   // init-readiness.ts:240
```

So the operator is the trigger. Every source merge silently leaves a stale daemon until a human remembers to restart it, and "did this fix take effect?" becomes a question the harness cannot answer for itself. Observed repeatedly on 2026-09-12/13: a merged fix for a defect blocking every pipeline control verb did not take effect until the operator bounced the daemon by hand, and the agent driving the session could not do it.

## Decisions

- **The daemon triggers its own handoff. No operator command, and no client-side trigger.** A CLI dispatch noticing staleness is still an operator action in disguise — it only works if somebody happens to run something. Rules out both the manual bounce and a "next command upgrades it" design.
- Detection compares the on-disk executable tree digest against the loaded one, reusing `getExecutableTreeDigest` rather than watching files; rules out a second notion of daemon version.
- A change must be **stable across two consecutive samples** before it triggers anything. A merge, a rebase, or a `git checkout` rewrites many files over a short window, and acting mid-write would hand off to a half-written tree. Rules out thrashing on every intermediate state.
- Handoff uses the existing protocol unchanged: the incumbent admits nothing new, drains its owned work, and exits. **No kill, no restart-in-place, and admitted work is never interrupted.** Rules out anything that could lose a live run, which is the reason the manual bounce currently requires an idle machine.
- **A failed successor start must return the incumbent to normal admission.** If the incoming generation cannot bind or dies during startup, an incumbent left in its drain-only state would refuse new work forever with nothing to replace it — strictly worse than staying stale. Rules out a one-way cutoff.
- Self-upgrade is bounded and does not re-arm while a handoff is in flight; a successor whose own digest differs again settles on the next cycle rather than spawning a chain. Rules out an upgrade loop on a repository that keeps changing.
- The trigger is observable: the incumbent records why it initiated handoff (loaded vs observed digest) so an operator reading the log can tell a self-upgrade from a crash-restart. Rules out generations appearing and disappearing with no recorded cause.

## Acceptance criteria

- [ ] A test proves a daemon whose observed executable digest differs from its loaded digest, stably across two samples, initiates handoff without any client request; it fails against the current code, where nothing consumes the comparison.
- [ ] A test proves a digest that differs on one sample and reverts on the next does not initiate handoff.
- [ ] A test proves an in-flight run admitted before the handoff runs to completion under the outgoing generation and is never interrupted by the self-upgrade.
- [ ] A test proves that when the successor fails to start, the incumbent resumes admitting new work rather than remaining drain-only.
- [ ] A test proves no second handoff is initiated while one is in flight.
- [ ] A test proves the initiating generation records the loaded and observed digests as the handoff cause.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — self-initiated handoff: detection, debounce, failure rollback, and the recorded cause.
- `v2/docs/operator-runbook.md` — retire "restart the daemon before relying on a just-merged harness fix"; state that a merged `v2/src` change takes effect on its own once the outgoing generation drains, and what `daemon status` `loaded` vs `current` means in the interim.
