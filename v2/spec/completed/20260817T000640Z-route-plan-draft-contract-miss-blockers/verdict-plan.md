1. Separate the routing keystone and routing-guard mutation checkpoints so each criterion links to a distinct test title and independently proves one behavior. Shared pin titles would conflate directives under the mutation verifier.

2. Add composed plan-draft coverage for staged `intent.md` being absent and non-file. It must prove settlement succeeds without writing there and without falling back to or modifying the durable spec path. This directly verifies both intent decisions together.

3. Add an anchored preservation criterion for existing generic contract-miss behavior, including successful append to an eligible file and inclusion of the blocker in the settled checkpoint. Preservation criteria must cite their pinning tests.

4. Define “existing regular file” precisely, including symlink treatment. Also state whether append failures on an otherwise eligible file propagate or preserve settlement; race hardening need not be added unless best-effort settlement is part of the intended contract.

5. Correct documentation outcomes to distinguish routing from persistence: every `plan.prompt.draft` contract miss resolves to staged `intent.md`, but a blocker is persisted only when that target meets the defined existing-regular-file requirement.
