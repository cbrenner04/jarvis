## Verdict — refinements required

**1. Post-close writes must be defined.** The write loop's iteration settle can return on timeout/abort without awaiting the in-flight invocation, so the invocation layer can still append `inbound_*` after the loop has closed the log. A file-backed writer with no post-close contract may write to a closed/recycled descriptor — and such a write does not throw, so "append failures are swallowed" does not cover it. Pin the writer's post-close behavior (appends after close are dropped; close is idempotent) and explicitly rule out having close await a possibly-stalled invocation, with an acceptance criterion covering append-after-close.

**2. Cut the overclaim about stalled-invocation output, and name the deferral.** Invocation results carry stdout/stderr only on the settled result; nothing streams incrementally. A stalled invocation's log therefore contains the harness and outbound lines and nothing else — which the timeout acceptance criterion already implies but the prose contradicts ("how far it got"). Fix the prose to promise only what the design delivers (which agent/model/prompt, that the subprocess was spawned), and record `Deferred to first consumer: incremental inbound_* streaming from the binding — pin when an operator needs partial agent output from a stalled invocation`.

**3. Record the invocation outcome in the log.** As drafted, a timed-out, aborted, and errored iteration are indistinguishable on disk — which halves the forensic value the intent is buying. Require a settle-side `harness` line naming the outcome kind, written before close, with a matching acceptance criterion. This also gives the file a definite terminator, complementing (1).

**4. Filenames must be collision-free.** The log is opened in append mode with a second-granularity timestamp; two iterations of the same run can land in the same second (routinely so under stubbed bindings), which directly falsifies the "second iteration writes a second, distinct file" criterion. Pin a uniqueness mechanism (finer timestamp granularity or an explicit suffix) — one choice, in the ledger.

**5. Decide open/mkdir failure.** Append failure is decided; open and directory-creation failure is not — and the log is opened *before* the spawn, so an unwritable sessions dir would otherwise fail runs over an observability feature. Add the ledger entry (it rules out the plausible alternative of failing the invocation) and an acceptance criterion.

**6. Sessions dir and clock must be injectable through the write loop.** The writer's sessions dir is injectable, but the write-loop input has no field for it and the production path derivation hardcodes the home directory; likewise the distinct-filename criteria need a deterministic clock. Without both plumbed as write-loop inputs with production defaults, the tests write into the operator's real sessions dir. Pin both.

**7. Appends must be unbuffered.** The mid-invoke observability criteria (log readable from inside a binding stub) only hold if writes reach disk synchronously. That is a design constraint, not a test artifact — state it in the ledger.

**8. Doc homes are incomplete.** The invocation layer's step-runner signature changes, so the step-runner doc must be listed among documentation updates; add a cross-reference from the invocation-liveness doc, since that is where an operator lands when a run hangs — the exact case this feature serves.

**9. Terminology.** "Invocation attempt" is used for both a loop iteration and a binding attempt within the fallback chain. The design is unambiguous (one file per iteration; fallback bindings append to the same file), but the wording is not. Use "iteration" in the write-loop subspec and "binding attempt" in the writer subspec.

## Not required

- Quota / `model_config` / `error` results carry no stdout, so the "non-`ok` results write stderr under `inbound_stderr`" criterion drops nothing. It is fine as written.
- Session-log retention/rotation is a real operational concern but out of scope: v1 has identical unbounded growth and this spec is a parity play. Route it to a separate intent rather than expanding this one.
- No split. Both subspecs remain one independently reviewable change each with the additions above.