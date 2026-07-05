# Audit shared/preload.sandbox-unrunnable.test.ts

## Problem

`shared/preload.sandbox-unrunnable.test.ts` asserts that Bun's agent preload
actually mutates `PATH` for a real spawned process, by spawning a fake
`codex` binary found on `PATH` and checking its exit code. Unlike
`shared/git.ts`, the subprocess here isn't standing in for `git`/`gh` output
the boundary can canned-return — the assertion *is* "a real child process
inherits the mutated `PATH`." Decide whether that still holds under the new
boundary.

## Decisions

- If mocking the subprocess would remove the only thing the test proves
  (that Bun's real preload mechanism, not application code, mutates `PATH`
  for a real child), keep the file as a marked real-process exception per
  `v2/docs/test-writing.md`, and add an inline comment stating specifically
  why the mocked boundary from subspec 00 cannot substitute here — rules out
  silently converting it to a mock that would pass even if preload broke.
- If the audit instead finds the real spawn is incidental to what's being
  asserted, convert it to route through `shared/subprocess.ts` and drop the
  `.sandbox-unrunnable` marker, matching subspec 01's treatment of
  `shared/git.ts`.

## Task checklist

- [ ] Read `shared/preload.sandbox-unrunnable.test.ts` and the preload
      mechanism it exercises; determine whether the real spawn is load-
      bearing or incidental per the `v2/docs/test-writing.md` determinism
      checklist.
- [ ] Apply the outcome: either add the justification comment (keep marker)
      or convert to the mocked boundary (drop marker).

## Acceptance criteria

- [ ] `shared/preload.sandbox-unrunnable.test.ts` either (a) still exists,
      still spawns a real process, and carries an inline comment explaining
      specifically why the mocked `SubprocessRunner` boundary cannot
      substitute for this assertion, or (b) no longer exists because it was
      converted to a mocked, marker-free test and its real-process assertion
      was verified redundant/incidental.

## Documentation updates

- None beyond the in-file justification comment required by the acceptance
  criteria above.
