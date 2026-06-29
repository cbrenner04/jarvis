## Verdict: refinements required

The spec is intent-aligned and correctly scoped as one end-to-end subspec. Several gaps would let implementers diverge on observable behavior or leave documented surfaces stale.

### Required refinements

1. **Absent-script skip predicate** — Pin the full skip contract in decisions (and reflect in ACs): qualifying package-manager command shapes and prefix list; how the script name is extracted (token after `run`, flags ignored); non-PM `fixCommand` values always execute with no `package.json` pre-check; missing or unparseable root `package.json` → skip autofix (no `FixCommandError`), consistent with existing fail-safe precedent.

2. **Skip vs full pre-verify phase** — Add a decision that absent-script skip means **do not invoke autofix only**; commit-if-dirty and verification (`readyCommand` / `bun run ready`) remain unchanged in order and failure semantics.

3. **Plan-mode resolution** — The spec names plan draft→ready as a gate site but gives no config resolution path (`maybeMarkPlanPrReady` has none today). Pin resolution via registered-project root match against plan worktree cwd (parallel to triage `readyCommand`), and add an AC that configured `fixCommand` is invoked at plan draft→ready.

4. **`maybeMarkReady` call-site coverage** — “Thread to `maybeMarkReady`” is insufficient: require `fixCommand` at **every** call site that can hit `full` tier (including `iteration.ts` per-iteration early-ready paths that today omit `readyCommand`). AC #1 should enumerate or cite all such sites, not treat `maybeMarkReady` as a single test locus.

5. **Triage gate coverage** — Add an AC for triage `fixCommand` resolution via project-root match. AC #1 wording should state the shared triage gate helper covers **`--mark-ready` and `--merge`** (decisions already require both). Task checklist should note triage `runGate` seam must carry `fixCommand` (or resolve both commands before the default closure).

6. **AC #5 symbol name** — Replace `validateConfig` with `loadConfig` (the actual validation surface).

7. **Documentation updates** — Add `v1/docs/run-loop.md` (operator workflow home; currently hardcodes `bun run fix`). Align `ReadyVerificationDirtyError` operator guidance — message today says “fold autofix into `readyCommand`”; with `fixCommand` split, docs and/or error text must reference the correct override.

8. **Default-path operator expectation** — State explicitly in problem/decisions: unset `fixCommand` keeps `bun run fix`; non-bun or no-`fix`-script repos must configure `fixCommand` (motivation, not a zero-config fix).

9. **AC #1 tier-forcing note** — Gate sites that tier-select (e.g. review-final, `maybeMarkReady` on unchanged tree) need tests that **force `full` tier** when asserting configured autofix invocation, matching existing `readyCommand` site-test patterns.

### Not required (defend as-is)

- Default `bun run fix` when unset; `fast` tier unchanged; verification-only `readyCommand` split; single subspec; silent absent-script skip; retry re-checking script presence each attempt; `bun` binary absent on default path (unchanged failure mode).

### Rationale

Items 1–2 prevent ambiguous skip vs failure and partial gate skips. Items 3–5 close wiring holes the decisions already claim but tasks/ACs do not fully bind. Items 6–8 satisfy spec guidance (behavior change → `v1-behaviors.md` plus operator workflow docs; accurate ACs). Item 9 prevents false-green site tests where `fast` tier would skip autofix entirely.
