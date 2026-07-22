1. Ensure the production Unix-socket path fits macOS limits. Preserve the full executable-tree digest as daemon identity, but use a viable filesystem representation/location and pin the production path-length constraint in tests.

2. Make same-key concurrent startup safe across real processes. Exactly one daemon may acquire ownership; losing starters must reuse the winner without unlinking its socket, overwriting its PID metadata, or spawning a competing daemon. Tests must exercise the real startup race and distinguish expected contention from other lifecycle failures.

3. Establish safe cross-daemon durable-state ownership or isolation. Differently keyed daemons must not concurrently admit the same project/branch, misreport one another’s runs as non-live, or perform unsafe status transitions. Ordinary resume duplication need not be assumed, but routing alone does not satisfy concurrent-daemon correctness.

4. Scope daemon stopping to the selected daemon’s owned work. Runs owned by another digest must not prevent stopping an idle selected daemon. This requires ownership semantics consistent with concurrent keyed daemons.

5. Make all TUI connection errors and log-follow feedback report the selected keyed socket, never the legacy fixed path. Align related inline contracts.

6. Fully align durable documentation with keyed socket, PID, log, lifecycle, dispatch, list/wait, TUI, and legacy non-interaction semantics. Remove contradictory fixed-path and bounce guidance from the required docs and other durable architecture/config homes governed by the documentation standard.

7. Add the mandated behavioral regression coverage. The test must run or faithfully model live legacy and differently keyed daemons, prove they receive no health, status, list, stop, or dispatch traffic, and fail against the pre-change fixed-socket behavior. Path-string assertions alone do not satisfy the acceptance criterion.
