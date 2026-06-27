**Required refinements:**

**[00] Commit-failure handling (High)**
The exit code when `commitWipProgress` fails is unspecified. Add a decision ruling out alternatives — commit failure should exit 1 (harness error, not an agent-error retry candidate) — and an AC covering that path.

**[00] Untracked-only progress definition (Medium)**
The decision "no progress → no commit" doesn't state that untracked-only file creation (no checked AC, no edited tracked files) is explicitly excluded from the progress signal. An implementer could reasonably treat untracked file creation as progress. The decision must explicitly name the excluded case.

**[00] Gitignored litter acknowledgment (Low)**
The decision that "litter clearing belongs to 01" should note that `git add -A` does not stage gitignored files, so those files remain in the worktree after a WIP commit and are 01's responsibility. One line suffices; no scope change required.

**[01] Litter definition (High)**
The spec defines "agent litter" as untracked, non-ignored files — but if subspec 00 stages all non-ignored untracked files into the WIP commit, litter in a resumed WIP worktree is by construction empty under that definition. The test would verify nothing real. The litter definition must be corrected: for resumed WIP branches, litter includes gitignored files (e.g., `test_output.txt`). This is the sharpest cross-subspec defect.

**[01] Retirement failure modes (Medium)**
`git worktree remove --force` and `git branch -D` can fail (branch checked out elsewhere, FS error). Neither outcome is decided. Add a decision: retirement failure aborts the run with a named error rather than silently proceeding into a collision. Add a corresponding AC.

**[01] Preservation AC missing test citation (Medium)**
"Existing `ensureWorktree` reuse tests stay green" is a preservation AC per spec guidance and must cite the actual test file path. Find and pin the path before refinement closes.

**[01] Partial worktree/branch states (Low)**
Branch-without-worktree and worktree-without-branch are not addressed. Add a decision scoping these degenerate states out explicitly rather than leaving them implied.

**[01] Subspec 00 as soft dependency (Medium)**
Subspec 01's litter-clear test design depends on whether 00's WIP-commit behavior is in place (it changes what constitutes litter in the test setup). Declare 00 as a dependency so the test author sets up state correctly.