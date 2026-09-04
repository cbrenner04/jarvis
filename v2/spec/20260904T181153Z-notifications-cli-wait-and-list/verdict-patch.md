## Verdict

**Fix before merge:** Unknown `jarvis notifications <subcommand>` must print parent usage (`NOTIFICATIONS_USAGE`), not `NOTIFICATIONS_WAIT_USAGE`. Current behavior breaks the same convention as `pipeline` and the `cli.test.ts` `parentUnknownOutput` contract for the `notifications` parent. Add a co-located test that an unrecognized subcommand exits `1` and stderr is parent usage.

**No other actuator changes required.** Implementation matches subspec 00/01: `--since` defaults to `sinceMs: 0`, wait stdout is `{ incident, deliveryCursor }`, list is incident-only NDJSON, runbook updates are in scope, and thinner tests (`empty --kind`, invalid `--since`, RPC errors, omitted `--since` on wait, etc.) are acceptable follow-ups outside the ticked acceptance criteria.