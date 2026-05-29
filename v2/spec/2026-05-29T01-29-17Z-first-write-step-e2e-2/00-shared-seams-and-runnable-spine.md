# 00 - Shared seams and runnable spine

## Decisions

- Extract prompt-registry and prompt-render plumbing needed by v2 into a root-shared module consumed by both trees.
- Extract the narrow agent-invocation types needed for one write step into the same root-shared seam only if the first v2 caller cannot stay host-local without duplication.
- Add one shared `write` prompt artifact under top-level `prompts/` and register it through the explicit seed list.
- Pin one Phase 1 write-step binding end to end: one behavior, one rendered prompt, one cli+model adapter path, one typed result surface.
- Keep the execution core host-agnostic: inputs are pure data plus `AbortSignal`; outputs are typed outcome data with no process exit codes or stdio text.
- Keep the CLI host thin: parse args, construct the one-step request, call the core, print the result, map process-facing failures.
- Surface the architecture outcome tokens unchanged: `done`, `no-work`, `blocked`, `progress`.
- Surface `progress` as a non-terminal one-shot result with no automatic retry; looping is Phase 2.
- Run deterministic output-contract evaluation only on `done` and `no-work`.
- Defer to first consumer: exact CLI spelling and argument shape — pin when the CLI tests and operator doc need one concrete invocation.
- Defer to first consumer: the narrow contract primitive set beyond terminal-token gating — pin when the first write step names its concrete artifact checks.

## Tasks

- Add the shared-source seam that lets `v2/src` consume prompt rendering without importing `v1/**`.
- Add the first shared `write` prompt and registry entry.
- Implement the host-agnostic one-step write core in `v2/src`.
- Implement the thin v2 CLI path that drives one write step once.
- Add tests for prompt render wiring, typed outcome mapping, abort propagation, and one successful single-step run through the CLI/core seam; worktree materialization stays stubbed here.

## Documentation updates

- Update `v2/docs/v2-architecture.md` for the Phase 1 core/host/shared-seam boundary if the shipped API shape differs from the current architecture wording.
- Do not add operator workflow docs yet unless the chosen CLI contract is fully exercised in this subspec.

## Acceptance criteria

- [ ] `v2/src` contains a host-agnostic one-step write entrypoint that accepts cancellation via `AbortSignal` and returns typed `done` / `no-work` / `blocked` / `progress` results without process-coupled fields.
- [ ] The top-level prompt registry contains a shared `write` prompt artifact and v2 tests prove the Phase 1 step renders through that shared registry path rather than a v2-local prompt source.
- [ ] The v2 CLI can execute one successful single write-step test path end to end through parse → render → invoke → typed result reporting, with automated coverage in `v2/src/*.test.ts` and no real worktree dependency.
- [ ] Root verification remains green after the slice lands: `bun run typecheck` and `bun test`.
