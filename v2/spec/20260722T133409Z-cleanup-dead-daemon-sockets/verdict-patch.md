## Verdict: required outcomes before merge

### 1. Report preserved sockets when they are the only socket work

When cleanup finds no worktrees, no stranded artifacts, and no dead sockets, but does find preserved (unprobeable) sockets, the run must still print those sockets with their reasons. It must not take the early-return path that prints “No eligible worktrees or stranded artifacts to clean up” and exits.

**Why:** Subspec AC requires unprobeable sockets to be “preserved and reported with its reason.” Docs (`write-behavior.md`, `operator-runbook.md`) describe preserved sockets as visible cleanup output.

---

### 2. Substantiate the checked acceptance criteria with real tests

Several criteria are marked done but not pinned by tests that would fail if the behavior regressed:

| Outcome | What must be true |
|--------|-------------------|
| **Unprobeable preservation** | A test forces a probe outcome other than `ECONNREFUSED`/`ENOENT` (timeout, permission error, etc.) and asserts the socket lands in `preserved` with a reason — not merely in `dead ∪ preserved`. The test must fail against code that deletes on any non-success probe. |
| **Live socket preservation** | A test places a socket that a live daemon answers on (real listener or injected successful health probe) and asserts cleanup does not remove it and does not classify it dead. |
| **Enumeration failure** | A test places a `daemon-*.sock` under a jarvis home where enumeration fails (e.g. unreadable directory), runs cleanup/reaper, and asserts that socket is not removed. “Home does not exist” alone is insufficient. |
| **`--dry-run` listing** | A dry-run test asserts the dead socket path (or explicit “remove:” preview line) appears in stdout, not only that the file survives and “dry-run” is printed. |
| **Guard-inversion coverage** | Per the subspec AC and repo guard-coverage convention, each added guard must have a test that fails if inverted: live-socket guard, unprobeable-preserve guard, enumeration-failure guard, dry-run guard. Each inverted guard must cause a test to observe removal of a socket that must survive. |

**Why:** Checked ACs and the subspec task list require these branches to be covered. Current fixtures (plain files at `.sock` paths) exercise the dead path on darwin but do not distinguish live, preserved, or enumeration-failure behavior.

---

### 3. Remove dead code

`rmSync` is imported in `daemon.ts` but unused; removal happens in `cleanup.ts`. Drop the unused import.

**Why:** Trivial hygiene; avoids lint noise.

---

### Not required for this patch

- **Post-confirm socket re-probe:** Not specified; race window is narrow. Reasonable hardening follow-up.
- **Health RPC vs bare connect in docs:** Behavior is intentional; one-line doc clarification is optional.
- **Partial cleanup on `rmSync` failure, CLI requiring live invoking daemon, silent enumeration failure, integration tests, legacy `daemon.sock`:** Out of scope or spec-compliant as implemented.
