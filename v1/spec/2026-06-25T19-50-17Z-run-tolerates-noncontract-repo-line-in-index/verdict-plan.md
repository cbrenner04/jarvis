## Verdict — Refinements Required

The spec's structural shape and its acceptance criteria are sound and target the real gap. The defects are in the **Problem/Behavior narrative and cited inputs**, which misread current code, and in **under-pinned error-message behavior**. Refine as follows.

### 1. Reconcile the narrative with what actually aborts at HEAD
The motivating inputs cited (`repo: https://github.com/cbrenner04/jarvis`, `repo: cbrenner04/jarvis`) do **not** abort on current code — both pass the `shared-entry.ts` guard (it exempts URL/slug forms) and fall through `resolveProject` without erroring when no origin matches. Proof: this spec's own `index.md` carries that exact URL line and is meant to be runnable. The Problem/Behavior sections describe a non-bug; left as-is they would steer the implementer to "fix" working behavior and add green-anyway tests. Rewrite Problem/Behavior to describe the **actual** abort inputs — a relative slash path (`./project`, `a/b/c`) and a non-slug bareword (`jarvis`) — and align the "Unresolvable covers" enumeration with them. Resolve the internal inconsistency between the Problem (URL/slug) and the ACs (relative/bareword); the ACs are the correct half.

### 2. Correct the two-abort-sites description
The claim that `resolveProject` errors on "no origin match for a bareword" is false — a slug with no matching origin falls through silently. The real second abort fires only when repo normalization returns undefined (non-slug bareword / multi-slash junk). Restate the second abort site accurately so the implementer targets the correct branch.

### 3. Make the task dependency explicit
Removing the `shared-entry.ts` guard alone (relax-only) just relocates the abort: a relative path still fails normalization and hits the `resolveProject` error. State plainly that the guard relaxation is inert without the `resolveProject` fall-through change — both tasks are required, and Decisions bullet 3 must not imply guard removal suffices on its own.

### 4. Pin the no-fallback error message
Decisions bullet 2 and the Behavior section promise to "surface the original relative-path error," but removing the guard **deletes** the `spec repo must be an absolute path` string. Specify which exact message the no-fallback case emits after the change (the unknown-repo resolution error), and reconcile all "relative-path error" language with the fact that the old string ceases to exist. The task checklist mentions updating the relative-repo test, but the AC only checks exit 1 — add an AC pinning the surviving message and the corresponding `run.test.ts` update so the contract is the message, not just the exit code.

### 5. Record the typo'd-key masking trade-off
After this change, a typo'd registered key (or any present-but-unresolvable `repo:`) is silently ignored whenever the location resolves — the run proceeds against the location-based target with `source: "registered"` instead of surfacing today's helpful "no project matches…" list. This is an observable behavior change aligned with the intent ("tolerate the line"), but it must be an explicit Decisions entry naming the alternative it rules out (erroring when a `repo:` is present but unresolvable). Per the ledger principle, a load-bearing trade-off a reasonable implementer could decide differently must be recorded.

### 6. Split the coverage AC by branch
Relative paths and barewords reach different abort sites; the generic "unresolvable `repo:`" AC #2 should be split so the relative-path → ad-hoc/registered and bareword → ad-hoc/registered cases are each independently pinned.

**Rationale:** The spec-guidance principle that refactor/preservation ACs cite a real test exists precisely to stop authors asserting behavior they didn't verify; the same risk produced this draft's URL/slug misreading. Reproducing the actual abort and pinning the surviving message close that gap. None of these refinements alter the spec's structure or its (correct) fix mechanism.