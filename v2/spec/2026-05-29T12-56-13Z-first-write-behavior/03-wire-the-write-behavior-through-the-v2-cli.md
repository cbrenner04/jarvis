# 03 - Wire write through the v2 CLI

## Decisions

- Keep `write` thin: supply `write.execute` plus its output contract and delegate invocation, token parsing, contract dispatch, and worktree lifecycle to shared layers.
- Land the first live Phase 1 path as one CLI-triggered run with one agent turn total.
- Keep the core entry host-agnostic and abortable; the CLI owns argv parsing, stdio, and exit mapping only.
- Record the operator flow in a behavior-named `v2/docs/` home, not `v2/docs/v2-architecture.md` or a phase-named file.
- Keep the first contract deterministic and minimal: prove the expected artifact exists in the materialized worktree.
- Update `v2/docs/prompts.md` only if the prompt contract changes beyond adding the first live `write.execute` artifact.
- Deferred to first consumer: exact CLI spelling and argument shape beyond the first tested command surface — pin when CLI tests force it.
- Deferred to first consumer: broader operator workflow beyond run-once invocation and local verification — pin when looping or workflows exist.

## Constraints

- Do not introduce a repeat loop, workflow runner, daemon host, durable state, PR lifecycle, or review behavior.
- Do not edit `v2/docs/v2-architecture.md`.
- Keep `progress` as a surfaced non-success result with no automatic retry.
- Keep contract verification deterministic and local to the prepared worktree.
- Keep write-specific code free of quota loops, token parsing, and contract dispatch.

## Task checklist

- Add the thin `write` wiring over the shared runner and worktree helper.
- Add one v2 CLI path that runs `write` once.
- Map shared results to the CLI surface without pushing CLI concerns into the core.
- Add end-to-end tests for the happy path and stop edges.
- Add the durable operator doc for `write`.

## Acceptance criteria

- [ ] The v2 CLI can invoke one `write` behavior run end-to-end: render `write.execute`, materialize the worktree, invoke one configured agent with fallback semantics from shared code, capture the outcome token, run the declared terminal contract when required, and surface the typed result.
- [ ] Write-specific runtime code only supplies its prompt identity and contract plus minimal wiring; it does not own an invocation loop, token parsing, or contract dispatch.
- [ ] The first terminal contract deterministically proves the expected write artifact in the worktree, and a contract miss surfaces as a distinct non-success result.
- [ ] End-to-end coverage proves the happy path plus the key stop edges: quota fallback success, terminal contract miss, agent-declared `blocked`, and `progress` with no retry.
- [ ] A durable operator doc under `v2/docs/` explains how to run the Phase 1 `write` behavior and how to verify success from the worktree/result surface without editing the architecture doc.

## Documentation updates

- Add one behavior-named operator doc in `v2/docs/` for running and verifying `write`.
- Update only the durable docs that must cross-link to that operator home.
- Do not add status to `v2/docs/v2-build-order.md`.
- Do not add implementation narrative to `v2/docs/v2-architecture.md`.
