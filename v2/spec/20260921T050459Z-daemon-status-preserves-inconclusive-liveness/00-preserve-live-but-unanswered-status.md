# Preserve live-but-unanswered daemon status

## Problem

`getDaemonStatus` (`v2/src/daemon/daemon-lifecycle.ts`) reduces every failed one-second `health` request to `stopped`. A daemon can still accept socket connections while its event loop delays the RPC beyond that budget, so `jarvis daemon status` can mislabel live work as dead and send the operator toward `kill -9` or a second daemon start.

## Decisions

- Status classifies the socket with `probeSocketLiveness` (`live | stale | absent`) after each missed health attempt; ruled out: retaining a boolean as a second socket-liveness classifier, or classifying only after the final attempt.
- The health-probe seam stays; add an injectable liveness classifier defaulting to `probeSocketLiveness`.
- Every failed health request (timeout, connection reset, RPC error) is a miss and takes the same route; ruled out: a separate path for non-timeout failures, since the boolean health seam cannot distinguish them.
- After a miss, `stale` or `absent` returns `stopped` immediately with no retry, including when the socket turns `stale`/`absent` between attempts; ruled out: retrying a positively dead socket.
- After a miss, `live` admits exactly one health retry with a strictly longer timeout; a second miss followed by `live` returns `inconclusive` carrying the short and retry budgets; ruled out: unbounded polling, a third attempt, or collapsing the exhausted sample to `stopped`.
- `live` is taken as-is from `probeSocketLiveness`, including a probe timeout with no peer connected; `inconclusive` does not require or expose `peerConnected`; ruled out: re-probing with the detailed probe to confirm a peer.
- Default budgets: short one second (unchanged), retry two seconds chosen as a health-RPC budget that bounds worst-case status delay; ruled out: deriving it from the connect-probe constant.
- The follow-up `status` RPC uses the timeout of the health attempt that answered (short or retry), so a retry that succeeds does not regress revision reporting; its failure still degrades to `loaded=unknown`.
- `jarvis daemon status` renders inconclusive as one stdout line beginning `inconclusive`, naming the health timeout and exhausted short/retry budgets, and exits `1`; ruled out: reusing `stopped`, exiting `0`, or emitting a recovery instruction.
- `stopped` and `inconclusive` both exit `1`; scripts distinguish them only by the first stdout token; ruled out: a distinct exit code.
- `init` readiness maps `inconclusive` to a not-ready daemon check with detail `daemon is not responding`, distinct from `daemon is not running`; ruled out: reporting a live daemon as not running, or treating inconclusive as ready.
- An answered health request keeps `running loaded=<revision>` / `loaded=unknown` behavior; ruled out: executable-revision comparison or revision-output changes.
- `daemon start` and `daemon stop` behavior is unchanged; status types widen only enough for the new result.

## Tasks

- Replace status's boolean socket-liveness classification with `SocketLiveness`, add the single longer health retry, and return structured inconclusive budget evidence.
- Widen `DaemonCheck` and `defaultCheckDaemon` in `v2/src/commands/init-readiness.ts` to map `inconclusive` to a not-ready daemon check.
- Add regression coverage through the default probers and deterministic injected coverage for retry count, increasing budgets, classification order, and revision reporting.
- Render the inconclusive result in `v2/src/commands/daemon.ts` without changing running or stopped output.
- Update the durable documentation below and remove the obsolete busy-daemon-reads-`stopped` recovery note.

## Acceptance criteria

- [ ] A regression test using the default (real) probers keeps a socket accepting connections while its health RPC exceeds the short budget and asserts status is not `stopped`; it fails against the pre-fix boolean-probe mapping.
- [ ] A deterministic injected-prober test proves one short health attempt and exactly one strictly longer retry precede an `inconclusive` result naming both exhausted budgets, with the socket classified `live` after each miss.
- [ ] A deterministic test proves health answering on the retry reports `running` with the existing revision output, and the `status` RPC receives the retry budget.
- [ ] A deterministic test proves a socket classified `stale` or `absent` after the first miss, or turning `stale`/`absent` between attempts, reports `stopped` without a further retry.
- [ ] A command test in `v2/src/commands/daemon.test.ts` proves inconclusive output begins `inconclusive`, names the health timeout and exhausted short/retry budgets, differs from `stopped`, and exits `1` without recommending `kill -9` or `daemon start`.
- [ ] A test proves `init` readiness reports the daemon check not ready with detail `daemon is not responding` for `inconclusive`; it fails against the pre-fix two-state mapping.
- [ ] The dead-socket and serving-daemon revision cases in `v2/src/daemon/daemon-lifecycle.sandbox-unrunnable.test.ts` and the exact running/stopped output cases in `v2/src/commands/daemon.test.ts` stay green after adapting the probe seam.
- [ ] `v2/src/commands/daemon.test.ts`'s start/stop tests and `v2/src/commands/init.test.ts`'s daemon-readiness tests (including the `daemon is not running` case) stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — define `stopped` as a `stale` or `absent` socket verdict, make inconclusive status unsafe grounds for destructive recovery or another start, and remove the busy-daemon-reads-`stopped` note.
- `v2/docs/daemon-host.md` — replace the stale pid-first status contract with health classification, one bounded longer retry, and the shared `live | stale | absent` vocabulary used by status and cleanup.
- `v2/docs/write-behavior.md` — add inconclusive output and exit `1` (shared with `stopped`, distinguished by first token), preserve running revision output.
- `v2/docs/v1-behaviors.md` — record the changed v2 status classification and inconclusive CLI contract.
