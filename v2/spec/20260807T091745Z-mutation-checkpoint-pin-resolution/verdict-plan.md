# Verdict: required refinements before merge

## 1. Pin-title resolution anchor and scan strategy

**Issue:** Task and decision-ledger wording implies forward scanning from the `// @mutate` line. In the motivating layout (multiline `test.each`, title on `])("…", …)` above the directive in the callback), that strategy cannot reach the title. Main already has adjacent-line forward attribution (`#2682`); the gap is continuation titles beyond the next line.

**Required outcome:** Decision ledger and tasks must state unambiguously how continuation titles are found — e.g., during backward walk, when a `test`/`test.each`/`describe.each`/`it` opener lacks an on-line title, scan forward from that opener for the continuation title (not from the directive index). Remove or replace “forward from directive” phrasing. Problem/decisions should say “beyond adjacent-line forward,” and doc tasks should reconcile with the existing operator-runbook bullet rather than describe greenfield behavior.

**Rationale:** Without a correct anchor, implementers can follow task prose literally and still fail the behavioral AC or ship the wrong fix. Behavioral ACs constrain outcomes but task/ledger misdirection is a merge blocker for implement runs.

---

## 2. Mutation-checkpoint acceptance criteria

**Issue:** Mutation ACs prescribe exact source strings (`for (let i = lineIndex + 1; …)`, `for (const altExt of [".ts", …])`) that do not exist on main and assume a specific implementation shape. If the correct fix is backward-anchored (per item 1), those anchors may be wrong or no-ops while behavioral ACs pass.

**Required outcome:** Mutation ACs must target guards that actually implement the specified behavior — either (a) fix the algorithm in the decision ledger first, then derive mutation anchors from that design, or (b) soften to outcome form (“inverts continuation-title resolution in `enclosingPinTitle`”; “inverts extension-tolerant basename lookup in `resolvePinningTestPath`”) and require a uniquely occurring anchor in landed code, consistent with prior mutation-checkpoint specs. No fiction anchors tied to a presupposed forward-from-directive loop.

**Rationale:** Spec guidance requires guard inversion to prove added guards; prescriptive nonexistent anchors strand implementers who satisfy behavior correctly or invert the wrong site.

---

## 3. Decision ledger scope vs proof

**Issue:** Ledger promises `describe.each` and multiline plain `test`/`it` continuation support; behavioral ACs prove only multiline `test.each`. Ledger is broader than what acceptance criteria verify.

**Required outcome:** Either narrow ledger/decisions to what ACs prove (primary `test.each` case), or add proof (representative AC or explicit “same mechanism” note with doc coverage) for the extra constructs. Do not leave ledger claims unsupported by acceptance criteria.

**Rationale:** Spec guidance: decisions should not outrun verifiable contracts; implementers may over-build unproven behavior or reviewers may assume coverage that tests do not provide.

---

## 4. Extension-tolerant basename lookup — fail-closed edges

**Issue:** Decision says tolerance applies “when stem is otherwise unique” but is silent when both `foo.test.ts` and `foo.test.tsx` exist, when alternate extensions yield multiple matches, or how this interacts with existing ambiguous-basename handling. Task (“zero matches, retry”) vs decision (“unique stem”) is slightly misaligned.

**Required outcome:** Decision ledger must state fail-closed behavior: extension retry applies only on zero primary basename matches; if primary or any alternate basename matches more than one file, resolution stays `unresolved_pinning_test` (same as today). Clarify that path-qualified references do not get alternate-extension fallback (already in ledger — keep explicit in docs/hand-fix guidance). Optionally note `.mts`/`.cts` exclusion or deferral in spec-guidance/runbook if not in tolerance set.

**Rationale:** Without explicit collision rules, implementers may guess wrong; operators need hand-fix guidance when tolerance does not apply (doc AC already requires this — decisions must supply the contract docs reflect).

---

## 5. Intent and subspec alignment

**Issue:** `intent.md` acceptance criteria omit the three documentation ACs present in the subspec; subspec adds forward-continuation ordering and `v1-behaviors.md` items not reflected in intent decisions/documentation lists.

**Required outcome:** Sync `intent.md` with the subspec (acceptance criteria, documentation updates, and material decisions) or state explicitly that the subspec is authoritative for implement runs. No drift between intent and routed subspec.

**Rationale:** Housekeeping that prevents plan-review and implement confusion about what “done” means.

---

## 6. Stale problem framing

**Issue:** Problem text says `enclosingPinTitle` matches “single lines only,” which overstates the gap given adjacent-line forward on main.

**Required outcome:** Reword problem (and related decision bullets) to describe continuation titles beyond the immediately adjacent line; note reconciliation with existing runbook behavior.

**Rationale:** Accurate framing avoids redundant work and wrong regression assumptions.

---

## Not required

- **Subspec split:** Intent explicitly declines splitting; both fixes share one verifier seam with independent behavioral and mutation tests. No split required.
- **Optional hardening** (preservation AC for `#2682`, path-qualified negative AC, continuation-regex detail in ledger, doc-assertion tests, queue-blocker reachability narrative, keystone note): acceptable deferrals; not merge blockers if the six items above are addressed.