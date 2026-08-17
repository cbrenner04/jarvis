## Verdict — refinement required (no split; one subspec remains correctly sized)

The design is sound and the slice boundary (orchestration only, no wire plumbing) is defensible. The following must be corrected or covered before this draft is implementable.

### 1. The aggregate-state bypass is wider than the ledger admits, and untested

The ledger justifies skipping aggregate `derivePipelineState` only against the reported defect (a sibling at an awaiting gate), but the rule as written also bypasses derived `running`, `rejected`, `deferred`, and terminal outcomes. That is probably the right call — refusing on a rejected or running sibling would reinstate exactly the sibling veto the intent rules out, and concurrent per-branch continuation is already the established shape on the approval path — but it must be stated rather than left implicit. Also record why the dangerous case is closed: if the *named* branch is itself live it has no `failed` row and refuses before any reopen.

Required: one ledger line owning the full bypass with that rationale, and acceptance coverage that constructs at least a sibling in `running` and a sibling `rejected`, proving each still reopens and dispatches only the named branch with zero sibling dispatch or row mutation.

### 2. The deferral rationale for "reopened but not continued" is false

The ledger claims that shape "only arises from a direct store call." It does not: reopen precedes the continuation claim, so an in-process continuation refusal (missing admission context or a refused claim) leaves the branch with no `failed` row after the RPC has already returned `resumed`, and branch resume then refuses that branch forever. Whole-pipeline rescue does not cover it either, since the existing reopened-pending rescue does not fire on fan-out shapes.

Required: keep the deferral if desired, but replace the rationale with an accurate one — the window is inherited from the unscoped path, branch-scoped rescue is out of slice — and name the stranded shape it leaves behind. Specs must not carry premises a reader can falsify against the base.

### 3. Two different fan-out boundaries are in play, undecided

Admission is specified against the split position derived from the succeeded splitting row, while the store scopes branch reopen from the lowest position carrying both a default and a named row, and then requires every pre-boundary selected row to be satisfied. These coincide only under the precondition that branch admission created a branch row at *every* post-split position.

Required: state that precondition explicitly, define the outcome when it does not hold (half-applied admission) including which refusal surfaces and that it carries branch detail, and decide the source of truth for the absent-branch refusal — durable rows versus split-derived branch keys.

### 4. The prescribed fixture cannot express the headline scenario

The implementer note directs reuse of the existing fan-out helper, which branches only two stages and leaves the approval gate row default-keyed and pending. That shape makes "a sibling sitting at an awaiting gate" unconstructible, and its pending default gate sits before the store's branch boundary.

Required: replace the fixture guidance with a production-shaped fan-out — branch rows at every post-split position, gate included — and drop the framing that this is reuse of the existing helper.

### 5. Refusal vocabulary has reachable gaps

Decide, with a named reason or an explicit rationale for reusing an existing one:
- a **rejected** gate on the named branch (today it would fall through to a generic malformed-continuation refusal, defeating the "which branch and why" purpose of the vocabulary);
- a named branch key on a pipeline with **no fan-out split**;
- an **empty or whitespace** branch key;
- the reason string for a named branch that is currently **running** (the outcome is right; the reason is uninformative).

### 6. Wire spelling and success payload

The deferral of IPC/CLI plumbing is fine, but pin the intended parameter spelling for the eventual `pipeline_resume` branch key so a later slice does not re-litigate it. Separately, refusals carry the branch key while the success outcome does not — decide that asymmetry explicitly rather than leaving it to the implementer.

### 7. "Per-branch continuation scope" overstates what continuation does

With a branch key, continuation still walks the shared default prefix from the beginning and still performs terminal-publication settlement. The ledger and the docs criterion both assert branch-scoped continuation unqualified.

Required: qualify the claim in both places, and state whether settlement behavior on a branch-resumed pipeline is pinned by a test or explicitly out of scope.

### 8. Documentation criteria and the stale catalog bullet

The documentation acceptance criterion bundles roughly seven independent claims into one checkbox, so it will be ticked on partial satisfaction — split it into independently verifiable criteria. Additionally, the v1-behaviors catalog bullet asserting that `pipeline_resume` is the sole stage-scoped resume entry point with a fixed refusal set becomes inaccurate under this change; name that bullet among the scheduled edits. The `pipeline_resume` RPC parameter table row remains accurate this slice and needs no edit; keep the already-scheduled correction of the claim that recovery paths always continue without a branch key.

### 9. `default`-named downstream branch

A downstream input named `default` produces a branch key that the aliasing rule makes permanently unaddressable. One ledger line acknowledging and disposing of this is sufficient.

---

Sizing is fine: these are ledger decisions, two acceptance-coverage extensions, a fixture-note correction, and a docs-criterion split. Keep the existing failing-test and keystone/mutation checkpoint structure intact; every added guard introduced by the refinements above must remain covered by a checkpoint on a real production line.