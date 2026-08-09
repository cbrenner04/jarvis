1. The spec routing index must mark subspec 00 complete through Jarvis-owned reconciliation. Its acceptance criteria are complete, so the unchecked entry incorrectly leaves the overall spec incomplete; do not manually edit `index.md`.

2. Ad-hoc tree nodes must own their branch label. `MonitorPipelineTreeAdHocNode` must carry the entry run’s branch label, rendering and pure-builder tests must consume that stored label, and documentation must match. Re-deriving the branch during painting violates subspec 01’s explicit ownership contract and checked acceptance criterion.

3. Rename the obsolete test describing role suffixes. Its name must reflect that workflow children differ by indentation while all run rows now use role-first labels, so the test communicates current behavior accurately.
