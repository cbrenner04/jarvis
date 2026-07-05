# Mock shared/git.ts tests through the boundary

## Problem

`shared/git.sandbox-unrunnable.test.ts` spawns a real `git` binary in a
`mkdtemp` repo for every case. With the injectable runner from subspec 00
in place, the same behavior is verifiable by injecting canned argv/stdout/
exit-code, so the test no longer needs a real subprocess or the
`.sandbox-unrunnable` marker.

## Decisions

- Rewrite the test to inject a fake `SubprocessRunner` that asserts on argv
  (cmd + args + cwd) and returns/throws canned results per case, replacing
  the real `mkdtempSync` git repo — rules out keeping the real-repo fixture
  "just in case," which is exactly the redundant real-subprocess coverage
  this intent removes.
- Rename the file to drop the `.sandbox-unrunnable` infix
  (`shared/git.test.ts`) once it no longer spawns a real process. The infix
  is a human/reviewer signal, not a test-discovery mechanism (`test:shared`
  runs every file under `shared/` regardless of filename) — dropping it
  reflects that the file is no longer a real-process exception, it doesn't
  change what test command picks it up.

## Task checklist

- [x] Rewrite `shared/git.sandbox-unrunnable.test.ts` as `shared/git.test.ts`,
      injecting a fake `SubprocessRunner` in place of a real git repo.
- [x] Cover the same cases as today: local branch exists/doesn't,
      origin-tracking branch exists only after fetch, current branch reflects
      checkout.

## Acceptance criteria

- [x] `shared/git.test.ts` exists, asserts the same `branchExistsLocal`,
      `branchExistsOnOrigin`, and `getCurrentBranch` behavior as the prior
      `shared/git.sandbox-unrunnable.test.ts`, and spawns no real subprocess
      (mocked `SubprocessRunner` injected throughout).
- [x] No file named `shared/git.sandbox-unrunnable.test.ts` remains.

## Documentation updates

- None: test-writing.md's existing DI-seam guidance already covers this
  conversion; no new convention introduced.
