# The completion commit message is a fixed template — the git history is unreadable

## Problem

Every v2 implement run commits with the same hardcoded subject. `completion-commit.ts:71`:

```ts
message: `jarvis: complete run\n\nSpec: ${specPath}\n\nJarvis-Agent: ${agent}`,
```

So `git log` on `main` is a wall of identical `jarvis: complete run` subjects — the change a commit
made is invisible without opening the diff or the linked PR. Observed across every v2 implementation
this session (#1681, #1684, and both cleanup attempts). Compare v1's squash-merge subjects, which
carry the spec's own title.

The subject is the one place a reader scans first and it carries zero signal. `git bisect`,
`git blame`, `git log --oneline`, and release notes are all degraded by it.

## Decisions

- The completion commit subject describes the change, not the harness action; rules out a fixed
  `jarvis: complete run` string for every run. The spec name/title is already in hand at commit time
  (`input.specPath`) and is a reasonable default source.
- The `Spec:` and `Jarvis-Agent:` trailers stay; rules out losing the attribution/routing metadata
  that `completion-commit.ts` and `pr-body-refresh.ts` depend on.
- The idempotency check that recognizes an already-made completion commit
  (`headMessage.startsWith("jarvis: complete run")`, `completion-commit.ts:60`) must move to a marker
  that survives a variable subject — e.g. the `Jarvis-Agent:` trailer or a dedicated trailer; rules
  out a variable subject silently breaking the retry-after-failed-publish path.
- Decide the authorship source deliberately: derive from the spec title (cheap, deterministic) vs.
  ask the shrink/narrative agent for a subject (richer, another agent call). Prefer the spec-title
  derivation unless there is a reason to spend an invocation. Pairs with
  [[pr-body-is-a-bare-template-nothing-authors-the-narrative]] — same publication seam, same
  authorship question.

## Notes

Squash-merge means this commit's subject becomes the PR's default merge-commit subject, so this and
the PR-body seed compound: fixing the commit subject also improves what lands on `main` at merge.

## Documentation updates

- `v2/docs/v1-behaviors.md` — record the v2 completion-commit message contract once it changes.
