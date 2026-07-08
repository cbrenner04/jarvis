---
name: lean-daemon-test-standard
---
# Lean Daemon Test Standard

# Lean daemon-test standard

Amend `v2/docs/test-writing.md` so direct handler invocation (calling handlers returned by `createRunControlHandlers`/`createTailStreamHandler` in-process) is the default for daemon behavior tests. Limit socket round-trips to: the `ipc.test.ts` transport suite, at most 1-2 round-trip smokes per handler set (JSON marshaling proof), and `.sandbox-unrunnable` smokes. Replace the current worked example, which wires handlers through `startIpcServer`, accordingly. Add to the determinism smell checklist: a new agent-runnable test gated on `skipIf(!canUseUnixSockets())` is a defect unless it is one of the retained round-trip smokes. Docs-only; no code changes.

## Prerequisites
