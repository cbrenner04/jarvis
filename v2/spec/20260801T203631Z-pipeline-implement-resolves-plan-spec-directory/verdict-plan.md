Verifying key implementation details so the verdict is grounded in the codebase.
# Verdict: required refinements

## 1. Pin normalization to chained stage resolution (`resolveImplementStage`)

The spec must stop presenting `resolveImplementStage` and `resolveImplementArtifact` as equivalent choices. Normalization belongs in chained implement **stage resolution**, applied to `prior.specPath` **before** the custom-builder vs preset-builder fork.

**Why:** Fake-builder acceptance tests observe `BuildImplementWorkflowStepsInput` directly; the custom-builder branch never reaches `resolveImplementArtifact`. Placing normalization only there would leave that path broken and fail AC1–AC3. `resolveImplementArtifact` is also shared with standalone implement preflight—directory→`index.md` there would change out-of-scope behavior. Intent already scopes this to “one pipeline handoff behavior at stage resolution (`daemon`).”

**Outcome:** Decisions, surface, and the “pin normalization site” task must name `resolveImplementStage` (or equivalent “before builder fork” wording) and remove `resolveImplementArtifact` as a candidate.

---

## 2. Move documentation updates into `## Acceptance criteria`

The three doc items (`operator-runbook.md`, `v1-behaviors.md`, `daemon-host.md`) must appear as checkboxes under `## Acceptance criteria`, not only under `## Documentation updates` / the task checklist.

**Why:** Spec guidance gates completion on `## Acceptance criteria` only; doc work left outside ACs can be skipped while the run completes.

---

## 3. Strengthen AC1 to cover directory shape **and** chained worktree wiring

AC1 must assert that a bare-directory prior artifact still yields correct `cwd` (prior entry-run worktree) and `baseRef` (prior branch), not only normalized `specPath` and absent `artifactPath`.

**Why:** AC4 preserves worktree/`baseRef` behavior but seeds `spec/feature/index.md`, not the bare directory plan records today. AC1–AC3 own the new normalization behavior; without worktree assertions on the directory fixture, the spec does not prove the full chained handoff for the reported bug shape.

**Outcome:** Extend AC1 (or add one AC) so bare-directory fixtures also pin `cwd`/`baseRef`; keep AC4 as a refactor anchor (“stays green”) without claiming it covers directory normalization.

---

## 4. Add mutation-checkpoint requirement for the pass-through guard (AC2)

AC2 must require a named mutation-checkpoint comment for the “already `index.md` → unchanged” branch, matching AC1/AC3 inversion language—or explicitly state AC1 and AC2 exercise one guard with two checkpoint comments.

**Why:** Spec guidance requires guard inversion on every modified guard; AC2 currently lacks symmetric checkpoint wording.

---

## 5. Pin error-message contract for missing-index failure (AC3)

AC3 (and decisions) must require failures to use the existing `pipeline-stage-resolve:` prefix, a worktree-relative resolved path, and wording that an index was expected—distinct from implement builder’s `Non-index spec requires --artifact`.

**Why:** “Names the resolved path and that an index was expected” is underspecified; inconsistent messages break operator docs and regression assertions.

---

## 6. Clarify scope: in-repo `commit: true` plan pipelines only

Add an explicit out-of-scope line: external/no-commit plan specs (artifacts under `~/.jarvis/specs/…`, not necessarily on the prior worktree) are not covered.

**Why:** Prerequisites assume worktree-relative directory artifacts; without this boundary, implementers may over-generalize normalization or failure handling.

---

## 7. Narrow or test the non-directory failure decision

The decision that rejects artifacts “neither a directory containing `index.md` nor a path whose basename is `index.md`” is broader than AC3, which only covers directory-without-index. The spec must either:

- add an acceptance criterion for a non-index **file** prior artifact (e.g. `spec/feature/00-work.md`), **or**
- narrow decision prose to “directory without `index.md`” as the only guaranteed failure mode for this slice.

**Why:** Plan artifacts today are always directories; without narrowing or an AC, the written contract over-promises relative to verification.

---

## Not required

- A separate AC proving `failure_detail` persistence before workflow-run creation (existing `advanceWorkflowStage` plumbing; operator contract belongs in docs once item 2 is fixed).
- Mandating real-builder / `isSpecAvailableInBaseRef` coverage beyond fake-builder ACs, provided normalization is pinned in stage resolution before preset build (same change fixes base-ref checks).
- Updating existing e2e fixtures that use pre-corrected `index.md` paths (note as follow-up only if desired; out of scope for this atomic subspec).