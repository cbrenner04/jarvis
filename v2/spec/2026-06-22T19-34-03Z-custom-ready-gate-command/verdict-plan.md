## Verdict

The spec's core design is sound — per-project-only config with rationale, `execFileSync`/no-shell tokenization, tier-env passthrough, and the doc updates (`v1-behaviors.md` + strict-key list) are all appropriate, and harness-internal symbol ACs are correct for this subspec. The following refinements are required before the design is complete.

### Required refinements

1. **Resolve the fast-tier / tier-ignoring-command hazard (must address).**
   The `fast` tier is selected only on a clean tree at recorded-green HEAD, on the assumption the gate command does *less* work and won't dirty the tree. An arbitrary `readyCommand` may ignore `JARVIS_READY_TIER` and do its full work on a `fast` run; if that dirties the tree (formatter, codegen, timestamps), the early-return-on-non-`full` path skips both the commit/push and the dirty-tree guard, leaving a dirty tree while proceeding toward marking the PR ready. The spec passes the tier env but never reckons with a command that can't act on it. Add a load-bearing decision that resolves this: either accept the hazard with explicit rationale (custom commands are expected to be idempotent / clean-on-clean-tree, preserving the green-carrier reuse the intent requires) or force `full` when `readyCommand` is set (surrendering reuse). Name the ruled-out alternative. This gap is uncovered by intent and by every current AC.

2. **Close the silent override-not-applied failure mode with per-site test ACs (must address).**
   A missed threading site fails *silently* — it falls back to `bun run ready` with no error — so test coverage is the only guard between a fully wired implementation and a half-wired one. AC#1 asserts the command runs "at every gate site" but leaves verification loose. Add explicit ACs that assert the configured command reaches each of the five sites (completion, pre-shrink, review-baseline, review-final, `maybeMarkReady`), including that it propagates *through* `maybeMarkReady → runReadyGateWithTier` to the command invocation — not merely that `runReadyGateWithTier` accepts the parameter. This also subsumes the `maybeMarkReady` AC-phrasing concern.

3. **Pin the plan-mode call site as out of scope (cheap, do it).**
   `runReadyAndCommit` has a sixth caller in plan-mode PR handling. The design correctly keeps it on `bun run ready` by simply not passing the override, but nothing in the ledger *pins* that boundary, so an implementer could wire it without any AC catching it. Add a one-line decision stating the plan-mode call stays unwired and the override is patch-only.

4. **State the whitespace-tokenization constraint (cheap, do it).**
   Tokenizing on whitespace means commands with quoted arguments (e.g. `make ready ARGS='a b'`) tokenize incorrectly — no shell, no quoting support. This mirrors the existing `updateSnapshotsCommand` precedent and is a defensible default, but per the repo's ledger discipline it's a constraint a competent implementer might handle differently (some would reach for shell parsing). Add one line recording the no-quoted-args limitation and naming the ruled-out shell-parsing alternative. Optionally note that `validateConfig`'s non-empty rejection is load-bearing for the runner's empty-after-tokenization safety.

### Not required

The objection that "resolve once and thread it" understates the plumbing (the five sites lack a `preflight` reference and need a new opts boundary per module, and the `updateSnapshotsCommand` resolution-point analogy is imperfect) is a fair wording tightening but not a structural defect. The spec specifies behavior and load-bearing decisions; it should not absorb a threading manifest. The author may drop or qualify the "mirroring resolution" claim, but no expansion is required.