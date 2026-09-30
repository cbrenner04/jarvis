---
id: review-feedback.rules
behavior: review-feedback-rules
kind: fragment
revision: 1
---
# Review feedback write

## Scope

- Modify only what captured PR feedback requires; do not expand scope beyond those items.
- Do not tick acceptance criteria or edit spec checklists.
- Do not edit `index.md` or reroute numbered subspec links.
- Read only files needed to land the feedback fix.

## Iteration

- Do not run `git commit` or otherwise create commits. Jarvis owns staging and committing.
- Run the tests target-repo guidance prescribes for the surfaces you touched (paths changed since the merge base); never the full suite unless that guidance resolves to it.
- Skip tests when the iteration changed only human-facing prose; run typecheck only when typed source changed.
- Leave the tree compiling.

## Stop

- Unclear: append `## Blocker` to the active sidecar or feedback artifact as your mode requires; stop with final line `blocked`.
- Repeated failure after edits complete: record failure and stop.
- No TODOs; put follow-up in operator-visible output only when blocked.
