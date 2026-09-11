---
name: prefix-resolution-refuses-on-an-absent-invoking-socket
---

# Pipeline id prefix resolution fails closed when the invoking digest has no socket

## Problem

`jarvis pipeline list` prints a short prefix as each pipeline's first column, and every pipeline verb is documented to accept it. In the ordinary state after any in-session merge, every verb refuses it instead:

```text
$ jarvis pipeline recover 9b1c81aa default
pipeline_id_set_incomplete: Cannot resolve prefix 9b1c81aa: a daemon listing was malformed or unavailable; restore daemon connectivity or use a known full pipeline id.
```

One healthy daemon was serving the machine, `pipeline list` had just rendered that exact prefix, and the full id worked on the next invocation. Hit twice in one session on 2026-09-11.

`resolvePipelineIdAcrossDaemons` (`v2/src/daemon/pipeline-daemon-resolution.ts:329-336`) declares the id set incomplete when any queried path is missing from the answers:

```ts
if (queryResult.hasMalformedResponse || socketPaths.some((path) => !(path in queryResult.snapshotsBySocketPath))) {
```

`resolveDaemonListSocketPaths` returns discovered sockets **plus the invoking digest's socket**. The daemon key is a digest of the jarvis source tree, so after any merge the invoking digest has no socket at all — that path is always in `socketPaths` and never in the answers, and the guard fires on every invocation.

The two conditions folded into that predicate are not the same claim. A socket file that exists but does not answer is inconclusive: a daemon may hold pipelines this listing cannot see, so refusing is right. A socket path that does not exist is conclusive: no daemon was ever listening on that digest, so it owns nothing and excluding it loses no ids. `pipeline list` already draws that line the tolerant way — it skips sockets that fail and merges what answers — which is why `list` renders an id that every verb then rejects.

## Relation to the root cause

This is one symptom of [[daemon-identity-is-not-its-version]]: the invoking digest's socket only fails to exist because the daemon's address is a function of its build. If that seed lands first, this one is moot — prefer it. Landing this one first is still worth it as a cheap, isolated unblock, since the umbrella is a large change and the prefix refusal costs an operator on every post-merge command.

## Decisions

- Distinguish conclusive absence from inconclusive failure when judging listing completeness: a socket path absent from disk does not make the id set incomplete; a present-but-unanswering or malformed socket still does.
- The verbs' behavior on a genuinely incomplete set is unchanged — `pipeline_id_set_incomplete` before any owner probe or mutation.
- Exact full ids continue to resolve without consulting completeness at all (current behavior, preserved).
- Scope is prefix resolution only. Owner resolution (`resolvePipelineDaemon`) and `pipeline list` are unchanged.

## Acceptance criteria

- [ ] A test proves a prefix resolves to its unique pipeline when the invoking digest's socket path does not exist on disk and every discovered socket answers; it fails against the current predicate.
- [ ] A test proves a prefix still refuses `pipeline_id_set_incomplete` when a socket path that exists on disk fails to answer or answers malformed; it passes before and after.
- [ ] A test proves an exact full pipeline id resolves regardless of listing completeness; it passes before and after.
- [ ] A test proves an ambiguous prefix still refuses with the candidate list when the invoking socket is absent, rather than resolving arbitrarily.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Owner-routed pipeline control verbs: which listing failures make a prefix unusable, and that an absent invoking-digest socket is not one of them.
- `v2/docs/daemon-host.md` — socket discovery: conclusive absence versus inconclusive failure in completeness judgements.
- `v2/docs/v1-behaviors.md` — record the relaxed prefix-resolution predicate.
