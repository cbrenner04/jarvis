**Verdict: uphold the test-import gap; no other action required.**

Required outcome:
- `v2/src/tui/tui-log-tail-client.test.ts` and `v2/src/tui/tui-daemon-client.test.ts` must import `DAEMON_SOCKET_PATH` from `../paths.ts` instead of locally recomputing it via `join(homedir(), ".jarvis", "daemon.sock")`. Drop the now-redundant local `DEFAULT_SOCKET_PATH` const (and the `homedir`/`join` imports in each test file if no longer used elsewhere) once the import is in place.

Rationale: the spec's entire purpose is eliminating independently-defined copies of these paths so a typo or future change can't silently diverge. Leaving these two test files with their own hand-built path duplicates that exact risk in the test suite itself — a change to `paths.ts` could drift from these tests without either catching the other. This is a direct, in-scope fix to files this same spec's Task Checklist already touches (both are the test counterparts of `tui-log-tail-client.ts` and `tui-daemon-client.ts`, which were migrated).

The doc-comment concern raised elsewhere does not hold — `paths.ts` has no pre-existing doc comments to be inconsistent with, and none are required by the spec or repo conventions for self-explanatory constants.