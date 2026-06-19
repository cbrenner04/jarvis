## Verdict: refinements required

Core split and decisions are sound. The draft leaves several load-bearing gaps where implementers would guess differently or ship contradictions. Required refinements:

### `00-implementation-prompt-routing.md`

1. **Pin the implementation prompt wire contract.** Name placeholders, delimiter style, registry `placeholders:` + revision bump, and whether `SPEC_PATH` remains (and what it means). Without this, template edits and snapshot governance are ambiguous.

2. **Pin repo-guidance read root.** State that `AGENTS.md` and root `CLAUDE.md` are read from the registered target repo root (`project.root`), not worktree-only discovery. Rules out silent omission when those files exist only at repo root and are not symlinked into the worktree.

3. **Pin behavior when `getActiveLinkedSubspecPath` returns `undefined`.** Choose and document one outcome: preserve today’s fallback (agent still invoked; prompt carries index-level context without linked-subspec body / AC gate) or stop before spawning the agent. Rules out a signature that always requires active subspec path/body and breaks the existing bare-task index path documented in `v2/docs/v1-behaviors.md`.

4. **Pin shared-template consumers without a linked active subspec.** Contract how `buildVerdictActuatorPrompt` and `buildFixupPrompt` use the migrated `patch.prompt.body`: routing prose removed, but no mandatory active-subspec block or repo-guidance preload where task source is verdict/fix-up preamble. Add tasks and acceptance criteria for actuator wiring and fix-up compatibility, not only negative “no pick-task” checks.

5. **Add acceptance criteria for non-index direct spec runs.** When the operator passes a subspec path (not `index.md`), the prompt must name that path, inline that file’s body, and omit index-routing instructions.

6. **Add positive verdict-actuator acceptance criteria.** Beyond absence of discover-yourself / pick-task prose, state what context the actuator prompt carries (e.g. optional empty repo-guidance, no active-subspec block, verdict section as task).

7. **Extend documentation updates to stop operator-facing drift.** Add `v1/docs/spec-guidance.md` (Agent Workflow must not instruct patch agents to pick the first unchecked subspec). Update `v2/docs/v1-behaviors.md` by replacing stale implementation/review bullets, not only appending. In `run-loop.md`, document the intentional split: banner excerpt (`getFirstUncheckedTask`) may differ from harness-injected active linked subspec when the index mixes bare tasks and linked subspecs.

8. **Correct intent problem statement.** Intent claim that implementation iterations inline the full spec tree is inaccurate today (`buildSpecTree` is review/shrink). Refine intent to duplicate routing via discover-yourself + pick-task while harness already resolves the linked subspec.

### `01-review-shrink-diff-bounds.md`

9. **Pin branch diff summary contract.** Define helper output shape (stat + changed-path list), merge-base semantics (aligned with existing branch diff helpers), path ordering/repo-relative form, and whether `BRANCH_DIFF` is renamed or only its content changes. Update review template headings/prose that still say “unified diff.” Rules out implementers shipping stat in a placeholder still labeled unified diff.

10. **Pin review regression test intent.** Acceptance criteria or tasks should state how tests detect full unified diff reintroduction on the review path (e.g. absence of hunk markers outside allowed blocks, presence of stat/path summary).

11. **Clarify patch review snapshot work.** If review step revisions bump, state whether patch review rendered fixtures are created (they do not exist today), not merely regenerated.

12. **Coordinate `run-loop.md` ownership.** Both subspecs touch review/iteration sections; index order (`00` then `01`) is sufficient sequencing, but each subspec’s doc tasks should name which `run-loop.md` sections it owns to avoid contradictory edits.

### Not required

- Mandatory shrink branch summary (additive optional is consistent with intent).
- Byte caps on repo-guidance preload or diff summary (file/path bounding is the contract).
- Banner/routing alignment beyond documentation of the existing split.
- New prerequisites block for in-repo refinement gaps.

### Rationale

Refinements close compile/runtime breaks on shared `buildPrompt`, preserve or explicitly change the documented `undefined` active-subspec path, make prompt contracts testable via snapshots, and keep durable docs (`documentation-standard.md` single-home rule) aligned with shipped patch-agent semantics. Without them, the spec’s acceptance criteria under-specify observable behavior the advocate and current code both treat as load-bearing.
