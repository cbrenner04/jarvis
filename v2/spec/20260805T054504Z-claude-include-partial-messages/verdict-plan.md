Verifying key claims in the codebase before issuing the verdict.
## Verdict: required refinements

1. **Document v1 blast radius as an accepted decision.** The flag lands in `shared/invocation`, which v1 plan, review, and shrink paths already use — not only v2. The spec’s “v1 claude argv bullet unchanged” note applies to `v1/src/agents/claude.ts` only and understates impact. Add an explicit decision that v1 shared-binding claude spawns pick up the flag and inherit the same idle-watchdog benefit; do not imply v1 is untouched.

2. **Correct the existing v1-behaviors parity claim, not only append a divergence bullet.** `v2/docs/v1-behaviors.md` currently states the shared claude binding “now matches v1’s spawn and parse contract.” Adding `--include-partial-messages` falsifies that sentence. The documentation acceptance criterion must require updating that existing claim (narrow/replace it) in addition to recording the flag as a v2 divergence with the v1-local argv bullet left unchanged.

3. **Rewrite stale `## Documentation updates` prose to match the documentation AC.** `operator-runbook.md` already records claude streaming after the 2026-07-13 shared-adapter change; the live work is scoping that claim to exclude long no-tool turns and recording that claude-first review/critic roles work once the flag is passed — not removing lore that claude was broadly unusable. Align the intent and subspec documentation-update bullets with AC 4’s narrower framing.

4. **Extend the “no `parseClaudeJsonOutput` change” decision with an explicit no-result fallback stance.** On zero-exit with no terminal `type:"result"`, the parser already falls back to raw stdout; partial events amplify that blob (including `thinking_delta`). The decision must state whether that degenerate case is accepted as-is or whether cursor-style text-frame fallback is in scope — and why — so implementers do not treat “no parser change” as silent acceptance of an unreviewed hazard.

5. **Acknowledge widened non-zero-exit quota phrase-matching exposure.** Zero-exit quota detection remains safe via structured envelope checks. Non-zero settlement still concatenates stdout into diagnostics where quota patterns can match model prose; partial/thinking text widens a pre-existing hazard rather than introducing a new one. Add a proportionate decision line (analogous to the existing cursor stream-json note in `v1-behaviors.md`) rather than redesigning classification in this spec.

6. **Add a claude idle-watchdog threading guard with honest framing.** Mirror the existing cursor binding test: prove `idleOutputMs` and timer re-arm on stdout chunks thread through the claude wrapper. Frame it explicitly as a wiring guard, not proof that `--include-partial-messages` fixes the stall — that remains the manual acceptance criterion and the CLI’s responsibility.

7. **Record residual time-to-first-token assumption.** `--include-partial-messages` streams thinking and assistant deltas once they start; the remaining stall window is spawn through first token on large prompts (seconds, not 90s). State this as an assumption the manual criterion validates, not grounds to re-scope.

8. **Record flag-availability assumption.** An unknown CLI flag fails every claude spawn in both engines with no graceful cascade. Close this with a decision that the operator’s installed claude CLI exposes the flag (single-operator repo).

9. **Pin the mutation directive to the single added argv line.** AC 3 must require a one-line `@mutate` replacement targeting `"--include-partial-messages",` alone; multi-line mutations are unparseable by the harness.

10. **Align intent test wording with the subspec’s explicit script list.** Intent AC 5 says “full test suite”; the subspec lists `typecheck`, `test:v1`, `test:v2`, and `test:integration:v2`. For a `shared/**` change these coincide under CI scope rules; align intent wording so both documents give implementers the same actionable verification list.

**Rationale:** Items 1–3 prevent doc drift and false parity claims at merge time — required whenever shared behavior diverges from v1-local spawn (`v1-behaviors.md` catalog rule). Items 4–5 close undocumented hazard boundaries the “no parser change” decision currently leaves implicit. Items 6–8 add cheap, proportionate guards and assumptions without splitting a single argv change on one module boundary. Items 9–10 satisfy spec-guidance harness contracts (mutation checkpoint parseability, agent-verifiable AC clarity). No split required: one subspec, one seam, one observable outcome.