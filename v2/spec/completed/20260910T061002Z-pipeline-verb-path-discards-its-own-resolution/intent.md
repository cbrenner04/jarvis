---
name: pipeline-verb-path-discards-its-own-resolution
---

# A pipeline verb routes by the id it resolved, then asks the daemon to act on the raw argument

## Problem

`withOwnerRoutedPipelineClient` (`v2/src/commands/pipeline.ts:578`) resolves a pipeline-id prefix to a full id, uses that id to find the owning daemon, and then **discards it**: the verb callback closes over the operator's raw argument instead. So the CLI routes to the owner of id `X` but asks that daemon to act on prefix `P`, relying on the daemon to re-resolve `P` against its own store.

The two resolutions can disagree, because they are computed over different id sets:

- The CLI resolves `P` against the **merged** set from every answering socket.
- The owning daemon resolves `P` against **its own** store.

`resolvePipelineIdAcrossDaemons` (`v2/src/daemon/pipeline-daemon-resolution.ts:326-332`) also drops `hasMalformedResponse`, which `pipeline list` does surface. So when one socket's `pipeline_list` is skipped or returns a malformed payload, the CLI's merged set is silently **narrower** than the owner's, `P` looks globally unique here, and the owning daemon may resolve it to a different pipeline or refuse `pipeline_id_ambiguous` — with no operator signal that the id set was truncated.

The two are one root cause: resolution work is performed and then thrown away.

## Why it matters

Prefix arguments are the ordinary way operators name pipelines (`pipeline list`'s first column is a unique prefix), and these verbs are `approve`, `reject`, `resume`, `recover`, `dismiss`, `undismiss`, `wait`. Acting on the wrong pipeline is a destructive-adjacent outcome for `approve`/`reject`. The narrow-set condition is reachable exactly when the machine is in the state this whole feature exists to handle — several keyed daemons, some not answering.

## Evidence (2026-09-09)

Found by independent diff review of [#3710](https://github.com/cbrenner04/jarvis/pull/3710) before merge, not by a failure. Recorded here rather than fixed inline because the change spans the callback signature and its four call sites (`wait`, mutation, `recover`, dismissal) plus their tests, and the lane was otherwise clean and complete (14/14 criteria, gate green, routing verified non-vacuously).

No observed misroute: this is a latent defect, seeded because the shape is one the repo has been bitten by — work whose result is computed and then not used, where the fallback silently does something *almost* right.

## Decisions

- The verb callback receives the resolved full pipeline id and sends that to the daemon; rules out the CLI and the owning daemon resolving the same argument against different id sets.
- A malformed or skipped `pipeline_list` response makes prefix resolution refuse rather than resolve against a knowingly-incomplete set; rules out a unique-looking prefix that is unique only because a socket was dropped.
- The refusal names that the id set was incomplete, distinctly from an ordinary ambiguous or not-found prefix; rules out an operator retrying a command that cannot succeed until the unreachable daemon is reachable.

## Acceptance criteria

- [ ] A test proves a verb dispatched with a prefix sends the resolved full pipeline id in its RPC params, not the raw argument; it fails against the current raw-argument passthrough.
- [ ] A test proves a prefix that is unique only because one socket's `pipeline_list` was malformed refuses rather than resolving; it fails against the current dropped `hasMalformedResponse`.
- [ ] A test proves that refusal is distinguishable from `pipeline_id_ambiguous` and from not-found.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — under the pipeline verbs, state that a prefix resolves against every answering daemon and that an incomplete id set refuses rather than guessing.
