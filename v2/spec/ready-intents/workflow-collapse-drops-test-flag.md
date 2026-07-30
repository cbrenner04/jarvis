name: workflow-collapse-drops-test-flag

# Workflow collapse guard proven without a production test flag

## Problem

`setInvertWorkflowCollapseForTest` (`tui-monitor-workflow-collapse.ts:5-9`) is a
mutable global in shipped code, and `buildWorkflowTableRows` branches on it
(`:156-158`). The collapse acceptance criterion is satisfied by toggling the
flag, so the test stays green even if the collapse guard were deleted.

## Decisions

- Delete `setInvertWorkflowCollapseForTest`; the collapse criterion is proven by
  mutating the guard itself so that deleting the guard turns its test red. Rules
  out keeping the flag because the criterion is literally satisfiable by toggling
  it. Production must contain no test-only mutable state.

## Prerequisites

