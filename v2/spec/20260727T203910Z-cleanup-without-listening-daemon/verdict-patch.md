1. Malformed daemon `list` responses must fail closed as `Daemon unreachable`, not be treated as an empty run list. Preserve stable preview text, nonzero daemon-skip exit semantics, and add regression coverage. Otherwise cleanup may retire a live worktree, violating the eligibility contract.

2. Align `intent.md` with the completed subspec: scope is the invoking executable’s digest-keyed socket, not “any key.” Multi-socket discovery remains out of scope.
