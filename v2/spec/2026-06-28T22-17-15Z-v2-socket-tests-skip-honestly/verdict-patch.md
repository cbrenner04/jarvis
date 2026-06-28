## Verdict — required outcomes

### 1. Complete `unix-socket.ts` export doc-comments per `v2/docs/documentation-standard.md`

**Outcome:** Doc-comments on `canUseUnixSockets` and `socketProbeErrored` must satisfy the inline standard: purpose, params (if any), **returns**, thrown errors (if any), and **invariants**.

**What must be true:**
- `canUseUnixSockets`: documents `@returns boolean`; states probe invariants, including the 100ms settle window and that a late `listening` event can flip availability after settle (the mechanism behind post-settle false→true). Registration vs hook-guard read semantics already present — keep them.
- `socketProbeErrored`: documents invariant that it is set during the one-time module probe, is `true` only on listen `error`, and stays `false` on timeout-without-error.

**Why:** AC #4 and the subspec Documentation updates require doc-comments that meet `v2/docs/documentation-standard.md`. Read-at-call-time and registration/hook asymmetry are covered; returns and probe invariants are not. Without the late-listening mechanism, the documented false→true flip is unexplained.

---

### Not required (no actuator action)

- **Behavioral skip proof in no-socket CI** — structural migration (`test.skipIf`, removal of silent-return wrappers) satisfies the spec; mandatory no-socket-environment proof was explicitly out of scope.
- **Late-`listening` false-skip** — documented, accepted tradeoff of `test.skipIf` registration-time gating.
- **`daemon-start-list.test.ts` `afterEach` hardening** — hook/registration asymmetry is spec-intended; `ipc.test.ts` already guards teardown. Residual edge case depends on unverified Bun hook scheduling for skipped tests; not a spec violation.
- **`socketTest` alias, import suffix inconsistency, `WorktreeOwnershipRegistry` gating, missing fixture unit tests, `describe` not skip-gated** — cosmetic, pre-existing, or out of scope; no blocking defect against written ACs.
