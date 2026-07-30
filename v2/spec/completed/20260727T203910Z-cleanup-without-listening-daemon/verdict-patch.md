1. Malformed daemon `list` responses must fail closed as daemon-unreachable, never as an empty run list. The skip must use stable text and affect exit status per the spec.

2. Daemon unreachability during post-confirmation eligibility recheck must make applied cleanup exit nonzero when retirement is withheld. Live-run and other non-daemon ineligibility must retain existing exit behavior.

3. Align the intent’s “any key” language with the defined scope: the digest-keyed socket for the invoking `jarvis`.

4. Narrow operator documentation so “unreachable” means a rejected or malformed probe. This spec does not require a timeout for an established connection that never responds; documentation must not imply otherwise.

Add regression coverage for the first two outcomes. These are required by the fail-closed eligibility and dry-run/decline/apply exit contracts.
