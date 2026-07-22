# 01 - Refresh the walkthrough for keyed auto-start

## Problem

`v2/docs/first-workflow-walkthrough.md` still tells a new operator that `jarvis run start` connects
over the fixed `~/.jarvis/daemon.sock` and that a manual `jarvis daemon start` is the entry step
(lines ~41–51, ~413). Sockets are now keyed by executable digest (`daemon-<key>.sock`) and mutating
dispatch starts the keyed daemon itself, so the walkthrough teaches a path that no longer matches
what the operator sees.

## Decisions

- Show the digest-keyed socket shape rather than a literal path; a pinned example path would be wrong on any other checkout.
- Keep `jarvis daemon start` documented as an explicit optional step, not the required first step; rules out implying lifecycle control was removed.
- Docs-only: no executable code changes in this subspec.

## Acceptance criteria

- [x] `v2/docs/first-workflow-walkthrough.md` contains no claim that dispatch uses `~/.jarvis/daemon.sock` and no fixed-socket example output.
- [x] The walkthrough's first workflow starts with a mutating `jarvis run` command; manual `jarvis daemon start` appears only as optional lifecycle control.
- [x] The walkthrough states that dispatch starts or reuses the daemon keyed by the invoking executable, and describes no bounce-after-merge step.
- [x] `bun run lint:md` passes.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md` — as above.
