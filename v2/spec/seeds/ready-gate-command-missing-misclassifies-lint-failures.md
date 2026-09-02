---
name: ready-gate-command-missing-misclassifies-lint-failures
---

# `ready_gate_command_missing` fires on gate output that names no missing command, stranding complete work non-resumably

## Problem

`isMissingReadyGateCommandOutput` (`v2/src/execution/ready-finalize.ts:103`) decides the gate's spawn target is missing by substring-scanning the **entire** gate output:

```ts
return /script not found/i.test(text) || /command not found/i.test(text) || /enoent/i.test(text);
```

The gate's output is the full `bun run ready` transcript — every test name, assertion message, lint finding, and stack trace. Any of those containing `ENOENT` (a common string in tests that exercise missing-file handling) or the phrase "command not found" classifies an ordinary red gate as a missing gate command.

The consequence is severe because of where that classification lands: `classifyReadyGateFailure` checks it **before** the command-mismatch and scope checks, and the resulting settlement is `nextAction: "fix_config"` with `resumable: false`. A run whose work is complete and whose only problem is a lint finding is told the operator must fix project config, and `jarvis run resume` is refused — so it can only be finished by hand.

## Evidence

Two runs on 2026-09-02, both with complete work, clean trees, and every acceptance criterion ticked:

- `20260902T035312Z-retire-tui-daemon-client-start` (run `124fdac2`) — settled `ready_gate_command_missing`; persisted `readyGateOutput` is entirely biome `noNonNullAssertion` findings, including for `v2/src/tui/tui-monitor-lines.ts`, a file **not in that branch's diff**. Hand-published as #3349.
- `20260901T112459Z-extract-review-debate-landing-module` (run `64934417`) — same settlement, all 3 subspecs complete (5/5, 3/3, 1/1), index ticked. Hand-published as #3351.

Note the persisted `readyGateOutput` is a bounded 4096-character tail and contains none of the three markers; the classifier reads the untruncated output, so the matching text is not observable from the run row. That is itself part of the defect — the operator cannot see why the classification fired.

## Decisions

- Classify a missing gate command from the **spawn failure**, not from scanning command output: a spawn `ENOENT` / non-existent executable is a property of the subprocess launch, and should be signalled by the runner rather than pattern-matched out of stdout/stderr.
- If output matching is retained as a fallback, anchor it to the shell's own failure line (for example a line beginning `error: Script not found`, or the package-manager prefix) instead of an anywhere-substring match over test output.
- When the classification does fire, persist the matched marker and its surrounding context on the run row so the operator can see what triggered `fix_config`.
- A misclassified lint failure must stay `ready_gate_failed` — resumable, with bounded repair — rather than becoming a non-resumable `fix_config` settlement.

## Acceptance criteria

- [ ] Gate output containing `ENOENT` only inside test names or assertion text does not classify as `ready_gate_command_missing` — pinned by a test whose gate output embeds `ENOENT` in a failing-test message and asserts `ready_gate_failed`.
- [ ] A genuinely missing gate command still classifies as `ready_gate_command_missing` — pinned by a test driving a spawn failure for a non-existent command.
- [ ] A `ready_gate_command_missing` settlement records the evidence that triggered it (matched marker plus context) on the durable row — pinned by a test.
- [ ] `bun run typecheck` and the `test:v2` pair pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — the **Missing gate command** paragraph: state what evidence the classification requires and that lint findings mentioning `ENOENT` no longer trigger it.
