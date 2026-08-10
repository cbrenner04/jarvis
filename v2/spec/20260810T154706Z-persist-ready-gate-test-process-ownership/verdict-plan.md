- Resolve replacement safety. The ownership model must not let a retry or resume overwrite an unsettled invocation that may still own a live process group. Define and test behavior for concurrent/stale registrations.

- Make process identity sufficient for the stated safety goal. The persisted evidence must reject PID/PGID reuse and still address leaked descendant-only groups after the leader exits, or the spec must explicitly narrow its guarantee. A leader-only identity does not support the intent’s current recovery claim.

- Define identity validity precisely enough to be verifiable: the process-identity source, required precision/comparison semantics, fail-closed behavior when identity is unavailable, and the relationship between group leader PID and PGID. Invalid, non-positive, mismatched, or sentinel identities must not create authorizing records.

- Define invocation-fence semantics. Every launch attempt must have a nonempty identity that cannot be reused across retries or resumes, and stale clear operations must return a non-success result without affecting a newer record.

- Define registration edge outcomes, including unknown owning runs, duplicate invocation registration, and registration while another invocation remains active. These cases are safety-relevant and cannot be left to implementation judgment.

- Put the required migration proof in the specifically named `persists active ready-gate test ownership across reopen` regression. That test must cover round-trip persistence, reopen durability, and upgrade from a database containing every pre-change migration, as required by the intent.

- Cover the intent’s end-to-end ownership contract. This persistence subspec may remain atomic, but the spec must include a separately linked, independently testable consumer subspec—or declare a concrete serial prerequisite/follow-on scope—that covers capture of trustworthy spawn identity, persistence before test execution proceeds, validation before signaling, and exact compare-and-clear after settlement. Persistence alone does not fulfill those explicit intent decisions.

- Preserve and verify isolation from run lifecycle status, ready-gate repair state, gate selection, command order, and healthy execution. The required refinements are safety contracts and must not broaden into gate-policy changes.
