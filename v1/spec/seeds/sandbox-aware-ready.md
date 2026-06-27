---
name: sandbox-aware-ready
---

# Make `bun run ready` sandbox-aware so the gate stops needing a blanket bypass

## Problem

`bun run ready` (and `bun run test`) must currently run **sandbox-off** in any
sandboxed operator environment (e.g. Claude Code). The reason is intrinsic, not
config: the 20 `*.sandbox-unrunnable.test.ts` files spawn real subprocesses
(git, agent CLIs, `gh`), which the sandbox's process isolation blocks. No
filesystem/network allowlist fixes this — the temp dirs already use `$TMPDIR`,
which is permitted; spawning is the blocker.

Net friction: every local gate run (operator finalize, contention re-run) drops
the whole sandbox, so the safe ~1650 tests lose isolation alongside the ~20 that
genuinely need it. The operator runs `ready` sandbox-off "full stop" today.

## Direction

Partition the gate so the sandbox-safe majority runs **in-sandbox** and only the
subprocess-spawning subset is treated specially:

1. **Split the suite.** A `test` target that excludes `*.sandbox-unrunnable.test.ts`
   (runs fully sandboxed) and a `test:sandbox-off` target for just that subset.
2. **Sandbox-aware `ready`.** Detect a sandboxed run; run the safe suite in-sandbox,
   then for the unrunnable subset either (a) auto-escalate *only those* outside the
   sandbox, or (b) skip them with a loud notice, deferring coverage to CI (which is
   unsandboxed and already runs everything). Pick one; (a) preserves local coverage,
   (b) is simpler. Unsandboxed runs (CI, sandbox-off) keep running everything.
3. **Keep admin-merge safe.** The runbook leans on local `ready` as the pre-merge
   net; if (b), the merge gate must still be backed by green CI on the unrunnable
   subset, not a silent skip.

## Documentation updates

- `v1/docs/operator-runbook.md` — § "The gate" and § "Sandbox blindness": replace
  "run `ready` sandbox-off, full stop" with the new sandbox-aware flow.
