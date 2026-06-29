## Verdict: required refinements

### 1. Resolve eligibility reuse vs scoped refusal contract

The decision to reuse `isEligibleForAbandon` conflicts with scoped ACs: today that helper is a global scan helper (stdout `skipping …`, boolean return); scoped mode requires stderr fail-fast and exit `1` on every named ineligible case including merged PR (global mode silently omits merged trees and may print `no abandoned worktrees to remove`).

**Required:** A decision and task stating scoped mode shares the same PR/merged/draft/multi rules as global abandon but through a scoped eligibility path (refactor or wrapper), not a direct call to `isEligibleForAbandon` unchanged. Retire semantics stay on `retireAbandonedWorktree`.

### 2. Pin operator-facing refusal messages

ACs require refusal without pinning text for unknown worktree, merged PR, ready/non-draft PR, multiple open PRs, PR inspection failure, or branch-resolution failure. “Clear error” is insufficient for testable, consistent operator UX.

**Required:** Decisions or ACs pinning stderr message shape for each scoped refusal case. Unknown worktree should match the established triage convention (`unknown worktree: <name>`). PR-related refusals should align with existing preflight/triage refusal style (not global `skipping …` stdout). Merged PR needs an explicit refusal message — rules out inheriting global silent ineligibility.

### 3. Pin scoped preview output contract

AC requires path and branch before confirm/dry-run; global abandon lists only branch under `Worktrees to remove:`. Reusing the global listing verbatim would violate the path+branch AC.

**Required:** A decision pinning scoped preview format (what prints, whether the global header is reused) and stdout vs stderr: preview on stdout; guard refusals on stderr.

### 4. Narrow confirmation deferral

Deferral covers single-target prompt wording only. Scoped cancel AC is testable only if confirmation behavior is pinned.

**Required:** Decision that scoped confirmation inherits global `[y/N]`, `cancelled` on decline, exit `0`, no side effects — deferral limited to prompt copy.

### 5. Add missing scoped ACs

Gaps relative to intent (“refuse when not abandonable”) and global parity:

- **Branch resolution failure** when `.worktree/<name>` exists but branch cannot be determined — refuse stderr + exit `1`, not global skip-and-continue.
- **Retire-step failure** on the named target (e.g. worktree remove throws) — exit `1`, matching global `hadFailures` semantics.
- **Decline confirmation** — exit `0` explicitly or cite the global cancel test for parity.
- **CLI positional parsing** — name accepted with `--abandon` (flag order independent, triage-style), extra positionals → usage error; task references `cli.sandbox-unrunnable.test.ts` but only help is in ACs today.

### 6. Align tasks with scoped implementation seams

Task list omits work the ACs imply:

- Scoped eligibility helper / `isEligibleForAbandon` refactor (see §1).
- Export or share read-only live-lock probe (`readLiveWorktreeLock` semantics: alive PID blocks, stale ignored) for cleanup — AC pins message and exit `9` but the probe is private in preflight today.
- CLI parse AC or drop the CLI test file from tasks if parse stays untested.

### 7. Intent alignment (plan artifact, not subspec body)

Spec correctly expands intent with merged-PR and PR-inspection refusal. Intent still omits those guards.

**Required:** Update `intent.md` when the plan PR lands so intent matches the spec’s refusal set.

---

**Not required:** New subcommand, global-mode behavior change (preservation AC citing global tests is correct), non-TTY readline semantics, `.keep` special-casing, success exit `0` pin (convention), or runbook/ready-intent follow-ons (correctly out of scope).

**Rationale:** Intent targets a single named retire with explicit guards; spec guidance requires behavioral ACs an implementer can verify; the advocate correctly identified real contract gaps where “reuse” and “refuse with error” collide and where unpinned I/O would produce divergent implementations.
