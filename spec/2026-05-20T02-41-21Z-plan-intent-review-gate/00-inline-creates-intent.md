# 00 - Inline one-turn intent draft

## Goal

`jarvis plan "one liner"` runs **one** agent invocation that turns the quoted text into a rough `intent.md`, then exits. It does not run Phase 0, draft, review, or the committed plan worktree/branch flow.

## Decisions

- **One turn only** — single non-interactive agent call; no refine loop, naming pass, or `plan: refine` commit.
- **Rough output** — expand/clarify the one-liner into a usable intent sketch; quality bar is “good enough to edit,” not plan-ready.
- **No structure contract** — unlike Phase 0, do not require `## Refine turn N`, `name:` frontmatter, or other refine-phase headings. Freeform markdown in `intent.md` is fine.
- **Persistence** — write `intent.md` to a chosen path (existing naming/placement rules TBD in implementation; may be cwd-relative or under `spec/`).
- **Separate entry point** — `jarvis plan path/to/intent.md` starts the full pipeline (subspec 01).

## Task Checklist

- Add a dedicated inline-draft prompt (e.g. `src/modes/plan/prompts/inline-draft.md`) scoped to one-turn expansion from the quoted string.
- Branch plan CLI so quoted-string invocation runs inline-draft only and returns.
- Reuse agent spawn/quota plumbing from plan mode where practical; do not open plan worktree or `plan/<name>` branch for inline draft.

## Acceptance criteria

- [ ] `jarvis plan "foo bar baz"` invokes exactly one agent turn and writes `intent.md` that expands on the one-liner (not a byte-for-byte copy unless the agent chooses that).
- [ ] Inline exits without Phase 0, `plan: refine`, draft, review, or `--resume-draft` prerequisites.
- [ ] `jarvis plan path/to/spec/.../intent.md` remains the entry point for the full committed plan run (subspec 01).
- [ ] `docs/plan-mode.md` documents inline as a one-turn intent draft step, separate from file-path plan.

## Documentation updates

- Split input modes in `docs/plan-mode.md`: inline = one-turn rough `intent.md`; file path = Phase 0 onward.
