1. The command regression must prove the assembled prompt contains the intent’s named prerequisite and runs against the fixture repository. Blocking and blocker text must derive from that prompt-carried prerequisite and repository evidence, avoiding closed-over false positives.

2. Prompt checks must reliably fail when any required policy is removed, reversed, negated, or contradicted: repository inspection, prerequisite evaluation, absent-behavior blocking without drafting, and observable-behavior drafting. Substring presence alone does not satisfy the mutation-sensitivity criterion.

3. The absent-evidence case must assert that no numbered subspec exists, not merely that one expected filename is absent. This pins the spec’s no-draft requirement against alternate subspec names.
