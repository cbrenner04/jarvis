---
name: plan-emitted-repo-line-in-index-breaks-run
---

# A stray `repo:` line in a plan-generated `index.md` makes `jarvis run` reject the spec

## Problem

The plan actuator sometimes writes a `repo:` metadata line into the spec
`index.md` (observed: `repo: https://github.com/cbrenner04/jarvis` and
`repo: cbrenner04/jarvis`). The index contract is title + subspec checklist
only. When `jarvis run` reads the spec, it parses that `repo:` line as a
project-repo directive and aborts before any work:

```
spec repo must be an absolute path: <https://github.com/cbrenner04/jarvis>
```

So a successfully-planned, merged spec is un-runnable until the operator
hand-strips the line — a manual step on the main path (it blocked two specs in
one session: auth-error and dep-adding; fixed by hand in PR #522).

## Direction

Two complementary fixes; plan to weigh:

- **Don't emit it:** the plan draft/actuator should not write a `repo:` (or other
  non-contract) line into `index.md`. Validate/strip non-contract index lines at
  the plan boundary check.
- **Don't choke on it:** `jarvis run`'s spec-repo parsing should ignore an
  unrecognized/relative `repo:` line in `index.md` (or only honor it from the
  intended config surface), rather than hard-aborting the run.

## Out of scope

- The legitimate `--repo` / project-resolution flow on the command line.

## References

- Plan draft/actuator writer in `v1/src/modes/plan/`; spec-repo parsing in the
  `jarvis run` spec loader (the "spec repo must be an absolute path" check).
- Observed 2026-06-25 (auth-error + dep-adding index.md; PR #522 hand-fix).
