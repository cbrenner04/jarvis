I've verified the key claims against the source files. The advocate's concessions hold up. Verdict:

## Verdict — `operator-runbook`

The deliverable's shape is sound (single flat doc in `v1/docs/`, structured to the AC coverage list). The problem is content accuracy — which is the one thing this spec exists to guarantee. Five issues must be fixed before finalize; three are polish.

### Required outcomes (must fix)

1. **Link from the root `AGENTS.md`.** AC4 ("`AGENTS.md` contains a link to `v1/docs/operator-runbook.md`") and the spec's Decision ("`AGENTS.md` is the sole link target") are unmet. The link currently lives only in `v1/docs/agents.md` (the agent-CLI reference doc) — a different file; `grep operator-runbook AGENTS.md` returns nothing. `CLAUDE.md` is a symlink to root `AGENTS.md`. The link must be added to the root `AGENTS.md` under an appropriate heading. Keeping the `v1/docs/agents.md` pointer is fine, but it does not satisfy the AC.

2. **Correct the admin-merge claim — it is backwards and fabricated.** The runbook (lines 93–100) asserts that `gh pr merge --admin` runs `bun run ready` / the completion gate "as part of the merge." This is false: `scripts/ready.ts` contains no merge/admin logic, and `gh pr merge --admin` is a server-side GitHub operation that cannot invoke a local gate. It also inverts the intent's actual rule — an admin-merge *skips* the completion gate's lint, so the operator must run `bun run check` (or `ready`) *before* any hand/admin-merge. The doc must state the correct guidance and drop the fabricated "merge triggers ready" claim. This is the exact verify-against-source failure AC3 and the first-review verdict were designed to prevent, and it defeats the spec's reason to exist.

3. **Remove the fabricated `--skip-ci` flag.** Line 23's `gh pr merge --merge --skip-ci` cites a flag that does not exist. Replace with an accurate way to achieve local-merge-then-retest, or drop the invented flag.

4. **Fix the inverted sandbox auth/localhost guidance.** Lines 76–79 treat sandbox `gh auth`/`localhost` failures as real and advise setting up auth outside the sandbox. The actual lesson (AC1: "false-negatives … auth, localhost") is the opposite: those failures were *false* — fine when run unsandboxed — so the rule is to re-run jarvis/git/gh/localhost commands with the sandbox off and not debug an apparent auth/connection failure before re-checking unsandboxed.

5. **Fix the inverted/fabricated pgrep rationale.** Line 70's "process argument strings can be rewritten by init systems" is invented; the real cause was a relative-path `pgrep` missing an absolute-path launch. Line 66 also labels the full-path match "Better," contradicting the lesson — the stable command-token match (`jarvis1 run`) is the fix, and path-matching is what *failed*. Correct the rationale and the example's framing so it encodes the actual experience.

### Recommended (faithfulness/value polish, not AC blockers)

6. **Complete the manual-finalize sequence.** The recovery section stops at `git commit`, dropping the intent's tail: tick satisfied ACs → `gh pr ready` → admin-merge. Completing it is cheap and matches the intent.

7. **Add a `git add -A` caveat.** The repo's own rules warn that `git add -A` absorbs manual commits and that Jarvis owns commits; showing it bare in a recovery doc invites the documented hazard. One line resolves it.

8. **Name what safe `check:fix` leaves behind.** AC3 is met (`noImplicitAny` correctly excluded as a TS flag; `check:fix`/`check:fix:unsafe` distinction accurate per `package.json`), but the section never names the residual unsafe items (`noExplicitAny`, unused-var, non-null-assertion) that need `--unsafe` or a hand edit — the intent's actual operative detail.

### Rationale

Issues 1 and 2 are hard AC failures (AC4; AC3's verify-against-source mandate). Issues 3–5 add fabricated or inverted operator guidance to a document whose sole value is correctness — incorrect guidance is worse than none, which is precisely what the spec's reviews exist to catch. Fix 1–5 in this pass; 6–8 should be folded in since the file is already open.