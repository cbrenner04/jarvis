## Verdict — Refinement Required

The spec's structure, shared-step placement, and refusal of the residual-failure path that broke `main` are sound. But the *mechanism* details — the same area where the prior attempt broke `main` — have load-bearing gaps. Hold for refinement on the following.

### 1. The `#NNN` fix is mislocated and the spec misstates how it's protected
`repairIntentFile` only rewrites `name:` frontmatter and appends `## Prerequisites`; it never emits a `#NNN`. Issue references come from the model splitter, not structural repair. So Decision 5 / Task 1 ("stop structural repair from emitting a line-leading `#NNN`") point at code that does not exist.

More important: markdownlint autofix for MD018 *inserts* the space (`#499` → `# 499`) — autofix **causes** the corruption it's claimed to guard against. The spec must:
- Name the real location where references are kept off line-start (splitter prompt / a content-normalization step), not "structural repair."
- State plainly that autofix cannot be relied on for this case and that the reference must be safe *before* autofix runs.
- Reconcile the acceptance criterion that `#499` survives with the fact that the only protection is keeping it off line-start upfront.

### 2. `--config` does not guarantee determinism on the no-commit path
The no-commit path runs the repair with `cwd = project.root`. In markdownlint-cli2, `--config` sets a *base* that directory-discovered configs still layer onto — it does not suppress discovery. A markdownlint config in the target repo could override the harness rule set on exactly the path the intent calls out as risky ("determinism is the point"). The spec needs an explicit decision ensuring discovery walks only harness-owned directories (e.g., run the subprocess with cwd at the harness anchor or a config-isolated location), plus a matching acceptance criterion.

### 3. "Same rule set as `lint:md`" is asserted, not established
`lint:md` runs the pinned binary with **no `--config` and no file args**, relying on root-cwd discovery and the config's `globs`/`ignores`. The autofix call uses `--config` plus **explicit file args**, which bypass `globs`/`ignores` — a different cli2 mode. Rule-set equivalence is plausible but not guaranteed by "uses the pinned binary." The relevant AC must pin equivalence empirically (the rules that actually fire/fix), not infer it from the binary path.

### 4. Binary-absent / spawn-failure behavior is undefined
"Ignore the binary's exit status" conflates two distinct cases: (a) nonzero exit from residual lint violations — correctly ignored; (b) spawn failure / binary absent — silently shipping un-fixed files reintroduces the operator hand-fixing this spec exists to eliminate, with no signal. (This worktree has no `node_modules`, so the path genuinely may not resolve.) The spec needs an explicit decision distinguishing the two: spawn failure must at least warn, not pass silently. Fold the unspecified harness-anchor resolution mechanism (how the repo root / binary is located across worktrees) into this decision.

### 5. Justify the subprocess, and fix the deterministic causes in-TS regardless
Both known violations are self-inflicted and deterministically fixable in-TS: MD012 from appending `## Prerequisites` to content already ending in `\n`; MD018 from the `#NNN` case above. The spec never argues *why* a subprocess over fixing these. State the actual rationale — autofix is a general guard against arbitrary model-emitted markdown, not just today's two rules — as a decision entry. Additionally, fix the MD012 cause in-TS (trim before append) rather than delegating a deterministic, self-inflicted defect to the subprocess; keep autofix as the general net.

### 6. Correct the MD041/MD025 reasoning and mark it an unguarded assumption
Decision 4's stated reason (the leading `---` block satisfies first-heading rules) is wrong: MD041's `front_matter_title` matches `title:`, not `name:` — it's the H1 *after* the frontmatter that satisfies MD041. The conclusion (these rules won't fire) likely holds, but correct the reason, and label this what it is: a one-time manual observation with no encoded guard.

### 7. Minor, mechanical
- ACs quote the relative `node_modules/...` path while prose says "harness-anchored"; under `cwd = project.root` that relative path resolves against the target repo. Make the quoted path explicitly anchored/absolute or stop quoting the relative literal. (Interacts with #2/#4.)
- The new before/after test depends on installed deps + a resolvable binary + spawn. Note this requirement, or have the test skip-with-signal when the binary is absent rather than error opaquely.
- AC 1 (full `lint:md` over the generated tree exits 0) is integration/manual, not cleanly automatable in the named unit file — mark `(Manual)` or fold into the seeded repair AC.

### Rationale
The intent's central constraint is determinism, and its history is a subprocess attempt that passed its own gate but broke `main` via config/rule drift and a residual-failure path. Findings #1–#4 each reopen exactly that failure mode (corruption, config drift, silent no-op). Per spec guidance, decisions must rule out the plausible wrong alternative and not assert behavior the author hasn't verified — #1, #3, and #6 currently assert unverified or incorrect mechanics. These must be resolved before drafting proceeds.