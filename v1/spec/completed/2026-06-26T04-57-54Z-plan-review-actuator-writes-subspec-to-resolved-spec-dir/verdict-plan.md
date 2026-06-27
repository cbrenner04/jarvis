## Verdict — Refinements Required

The spec's core diagnosis is sound (the actuator prompt lacks the write-boundary rule the draft prompt carries), but the draft under-delivers on enforcement, omits required prompt-governance mechanics, and leaves a shared-prompt side effect untested. The following refinements are required before this spec is implementable.

### 1. Add a structural write-boundary guard, not just a prompt anchor (must fix)

The intent calls for a "**guard**/test that a review pass … emits no spec file outside the resolved spec dir." A prompt nudge alone leaves the silent-commit mechanism intact: the actuator commit path validates only index existence and intent immutability, then runs `git add -A` + commit with **no** boundary check — whereas reviewer roles already enforce one (`assertPlanWriteBoundary`). A future prompt or agent drift would re-commit out-of-bounds files with zero enforcement, reproducing exactly the PR #549 failure.

- The spec must add a structural boundary check to the actuator commit path before staging/commit, mirroring the enforcement reviewer roles already use, so an out-of-bounds spec file is caught rather than silently committed.
- The revert/recovery mechanism must handle **untracked** stray files (a newly-created out-of-bounds directory), not just tracked-file checkout — `git checkout -- <path>` does not remove untracked paths. The spec must specify a removal mechanism that covers this case, or explicitly record the limitation.

### 2. Reconcile Decision #2 with how the draft actually anchors (must fix)

Decision #2 says to "carry the full prefix on the working/spec-dir lines, mirroring draft." That misdescribes the draft: in commit mode the draft's directory label lines carry the bare basename; the real anchor is an **imperative write-boundary rule** (`Only write files under <targetDir>/<NAME>/`) that the actuator prompt lacks entirely. An implementer following Decision #2 literally could merely relabel the directory line and add a materially weaker (or no) anchor. Restate the decision so the fix adds the same imperative write-boundary rule the draft uses.

### 3. Cover prompt-governance mechanics (must fix)

The actuator prompt is governed and pinned by a rendered-snapshot test asserting its revision. Editing the prompt body without bumping the revision and regenerating the fixture will break that test. The spec's checklist, acceptance criteria, and documentation-updates section are silent on this. Add explicit tasks/ACs/doc targets for: bumping the prompt revision, regenerating the rendered snapshot fixture, and updating the governance doc's revision line.

### 4. Make the external no-commit path an explicit scope call (must fix)

The fix edits a prompt shared by both commit and external no-commit flows. The draft prompt has a flat-layout branch for the no-commit case (files live at a flat `specDirPath` outside `targetDir`); the actuator prompt has no such branch and unconditionally applies the `targetDir`-prefix rewrite. A shared-prompt edit therefore silently affects the untested no-commit path. The spec must either add the parallel flat-layout branch (mirroring the draft) or explicitly state, with justification, that the external no-commit path is already correct and out of scope. It cannot stay implicit.

### 5. Tie the regression test to a real filesystem outcome (must fix)

The injected fake agent does not interpret prompts, so a prompt-only fix can only be verified by asserting the built prompt string — making AC#1/AC#2 ("overwrites the draft," "creates no file outside") tautological as written. With the structural guard (item 1), the test becomes real: script the mock agent to write a stray out-of-bounds file, run the actuator commit path, and assert the guard catches/reverts it and that nothing lands at `<root>/<timestamp-name>/`. Reframe the regression coverage around the guard. If any AC must verify the prompt, state it as "the built actuator prompt anchors writes to `<targetDir>/<NAME>/` (full prefix)" rather than implying an end-to-end agent file write.

### 6. Use a timestamped test fixture name (accept, minor)

The observed bug produced `<root>/<timestamp-name>/`. AC#3 pins a non-default `targetDir` but not a timestamped `name`. Have the test fixture's `name` carry the timestamp prefix so the regression reproduces the real on-disk shape.

### Optional (not required)

- An assertion that `index.md`'s link resolves to the refined content makes the in-place-overwrite guarantee explicit. Nice-to-have; the in-place fix already implies it via AC#1.

### Rationale

Items 1 and 5 are the heart of the matter: the intent asked for a guard, and the spec's own AC#2 ("no spec file outside the resolved spec dir") restates exactly what a structural boundary check enforces. Shipping a prompt-only fix would leave the failure mode unguarded and the regression test hollow. Items 3 and 4 are concrete, verifiable omissions — a governed prompt edit that skips the revision/snapshot mechanics breaks CI, and a shared-prompt edit that ignores the no-commit branch ships an untested behavior change. Item 2 is an internal inconsistency between the spec's Problem section (correct) and its Decisions (points at the wrong line) that would mislead the implementer.