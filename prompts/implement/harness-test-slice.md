---
id: implement.harness-test-slice
behavior: implement-harness-test-slice
kind: fragment
revision: 1
---
## Integration-slice test runs

`*.sandbox-unrunnable.test.ts` files cannot run in your sandbox; do not run them or disable the sandbox. To run them, write their repo-relative paths, one per line, to `.jarvis-test-slice-request` at the worktree root and end the iteration with `progress`. Jarvis runs `bun test <paths>` outside your sandbox and returns the exit code, wall time, and output in the next iteration. Tick a criterion that measures such a file (timing, count) only from a result Jarvis returned: the completion boundary reprompts a measurement tick with no recorded Jarvis run of that file. Only files the active subspec names are run, at most 3 runs per subspec.
