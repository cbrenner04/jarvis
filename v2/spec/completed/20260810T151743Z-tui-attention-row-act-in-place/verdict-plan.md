- Define reveal behavior for attention targets that are collapsed, non-representative run members. The spec must ensure Enter produces a visibly painted tree selection with appropriate ancestors revealed, or explicitly define another observable outcome consistent with the intent. The current assumption that every `targetId` is directly resolvable in the rendered tree is false.

- Require the Enter regression test to exercise the production tree-focus input route and fail when that binding is removed. Clarify Shift+Enter behavior in tree focus so the new binding does not introduce an accidental second activation path.

- Strengthen reveal acceptance to verify scroll-follow and presence in the painted tree rows, not selection state alone. This distinction is necessary for collapsed targets and fulfills the intent’s “selects and reveals” requirement.

- Enumerate every non-awaiting attention kind—`rejected-gate`, `failed-stage`, `failed-run`, `blocked-run`, and `publication-failure`—as refused with `not_awaiting_stage` and no RPC. Also define owner-loss precedence for an awaiting-gate row: `stale_non_targetable` with no RPC.

- Express preserved command-focus submission and command-hint behavior as existing-test preservation criteria using their actual test surfaces. New `tui-entry.test.tsx` cases should cover new behavior; unchanged behavior should follow the spec guidance by citing the tests that already pin it.
