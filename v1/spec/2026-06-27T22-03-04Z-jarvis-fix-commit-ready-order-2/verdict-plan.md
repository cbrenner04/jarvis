# Verdict: refinements required

The spec pins the core fix → commit-if-dirty → strict-ready contract, prerequisites, retry taxonomy, recorded-green timing, plan/`readyCommand` boundaries, and primary doc ACs. It is **not implementation-ready** until the gaps below are closed.

---

## Required refinements

### 1. `firstRedBaselineSha` / stuck-red discard vs harness fix commits

**Outcome:** Pin how baseline capture and stuck-red discard interact with a successful harness fix commit so the “do not revert harness fix commits” decision is mechanically satisfiable.

**Why:** Baseline is captured on the first completion-gate red at current HEAD. A retryable fix-command red can set baseline before fix commits; a later ready red plus stuck-red discard can `git reset --hard` to that baseline and drop the fix commit. The spec states the outcome but not the capture/discard rule that prevents it.

**Rules out:** Baseline-at-first-red with no carve-out for harness fix commits.

---

### 2. Custom `readyCommand` green + dirty — AC wording vs always-fix-on-full

**Outcome:** Rephrase the green+dirty acceptance criterion so it is unambiguous that on **`full`** tier the harness **always** runs built-in `bun run fix` before verification (including when `readyCommand` is set); the override replaces verification only; green verification with dirty porcelain aborts without a second harness fix pass to absorb override dirt.

**Why:** Current AC #3 (“without running harness fix for the override”) reads like skipping harness fix when an override is configured, contradicting AC #1/#10 and the decisions block.

**Rules out:** Implementers or operators inferring “no harness fix when `readyCommand` is set.”

---

### 3. Green + dirty abort — tier scope

**Outcome:** Pin whether green verification + dirty porcelain abort applies on **`full` only** (preserving today’s `fast` tier: no dirty check, no commit) or on **both** tiers.

**Why:** `fast` today returns after verification with no porcelain check. The spec pins the abort outcome but not tier scope; implementers must guess.

**Rules out:** Silent extension to `fast` or silent continuation of dirty override greens on `fast`.

---

### 4. Durable docs: `config.md` and `workflows.md`

**Outcome:** Add acceptance criteria and documentation-update entries for:

- `v1/docs/config.md` — on **`full`**, harness runs `bun run fix` before `readyCommand`; override is verification-only.
- `v1/docs/workflows.md` — completion-gate narrative matches fix → commit-if-dirty → ready (cross-link primary home or dedupe per `v2/docs/documentation-standard.md`).

**Why:** Both still describe post-ready dirty commits or override-only gates. Doc ACs cover `run-loop.md`, `plan-mode.md`, and `v1-behaviors.md` but leave authoritative contradicting homes.

**Rules out:** Checkbox pass with stale config/workflow prose.

---

### 5. Completion-gate retry documentation — beyond step reorder

**Outcome:** Task (and doc AC enforcement) must require replacing completion-gate retry prose that describes reusing uncommitted custom-`readyCommand` dirt with the fix-commit-persists-across-ready-reds model.

**Why:** `run-loop.md` still documents dirty-reuse on retry (~304–305, ~500–502). Doc AC names retry semantics but tasks risk order-only edits leaving incompatible narrative.

**Rules out:** Updated step list with stale dirty-reuse retry explanation.

---

### 6. `RunReadyAndCommitOpts` / seam contract

**Outcome:** Add an explicit task requiring opts, seam names, inject sites, and comments to reflect pre-ready fix/commit semantics (not post-ready dirty output).

**Why:** `ready-gate.ts` opts and `commitCheckFix` seam encode post-ready behavior; structure is load-bearing for tests and implementers.

**Rules out:** Reordered logic behind stale post-ready API surface.

---

## Recommended (cheap; not blocking implementation)

- **Triage gate failures:** Pin that triage `--mark-ready`/`--merge` pre-ready fix/commit/push/dirty failures stay exit `1` with no retry loop (ordering only is pinned today).
- **Fix-commit trailers:** Pin that fix commits preserve per-call-site `agentLabel` trailer threading.
- **Non-completion call sites:** Pin that pre-ready failures throw the same error types/messages; exit-code mapping stays caller-specific (completion `6`, triage `1`, etc.).

---

## Upheld as adequately pinned (no further refinement)

- Always `bun run fix` on `full`; commit only when porcelain non-empty after fix; abort on fix/commit/push/post-commit-dirty before verification and `gh pr ready`.
- Post-ready dirty-tree commit path deleted.
- Completion retry: full sequence re-run; fix-command retryable; commit/push/dirty non-retryable; fix commits persist across ready reds.
- Completion-gate pre-ready failures exit `6`.
- Recorded-green only after successful full verification with clean porcelain.
- Plan uses built-in fix + ready; no `fixCommand` knob; `fast` unchanged.
- Prerequisites, error-type/message alignment, expanded primary doc ACs, and behavioral test AC #13.
