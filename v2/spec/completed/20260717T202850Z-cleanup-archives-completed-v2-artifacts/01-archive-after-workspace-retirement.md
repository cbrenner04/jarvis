# 01 - Archive artifacts after workspace retirement

## Problem

Merged-workspace cleanup currently removes the worktree and local branch but leaves its completed spec artifacts at the v2 spec root.

## Decisions

- Attempt archival only after that workspace's Git retirement succeeds; rules out moving artifacts while their owner remains materialized.
- Resolve a retired plan to its configured v2 spec home from durable spec identity, including timestamped directory names; rules out guessing solely from the branch basename.
- Keep successful workspace retirement when artifact archival is refused, and print the artifact skip reason; rules out recreating or misreporting an already-retired worktree.
- Preview worktree retirement, spec archival, and proven intent pruning together under `--dry-run`; rules out hidden mutations after a narrower preview.

## Acceptance criteria

- [x] Confirmed `jarvis cleanup` archives each complete retired workspace's v2 spec into that home's `completed/` directory and prunes only its proven consumed ready-intent.
- [x] Failed workspace retirement leaves its spec and ready-intent untouched.
- [x] An incomplete spec, open matching PR, or different worktree owner remains at the spec root after the original workspace retires, with a specific stdout skip reason.
- [x] `jarvis cleanup --dry-run` previews the worktree, archive destination, and any proven intent prune without changing worktrees, branches, specs, intents, or run rows.
- [x] `v2/src/commands/cleanup.test.ts` adds a baseline-failing end-to-end case through `runCleanupCommand` using a real materialized worktree and proves retirement ordering, archival, refusal output, and dry-run preservation.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — document post-retirement archival, preview output, consumed-intent proof, and refusal recovery.
- `v2/docs/write-behavior.md` — add the operator-visible post-retirement cleanup flow and skip semantics.
- `v2/docs/v1-behaviors.md` — update cleanup's v2 behavior and sources.
