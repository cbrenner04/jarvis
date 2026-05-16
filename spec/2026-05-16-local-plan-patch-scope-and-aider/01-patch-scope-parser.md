# 01 - Patch scope parser

Runtime support needs a small parser for the active subspec's optional
`## Patch scope` section. This parser should be forgiving enough for Markdown
authored by humans and agents, but strict enough that Jarvis does not pass
dangerous or ambiguous paths to an agent CLI.

## Decisions

- Add a parser in the patch-mode area, near existing spec/subspec parsing.
- Parse only the active subspec body, not `index.md`.
- Return a structured value:

```ts
export type PatchScope = {
  editable: string[];
  readOnly: string[];
  outOfScope: string;
};
```

- If `## Patch scope` is absent, return empty arrays and an empty
  `outOfScope`.
- Only parse bullets under exact level-3 headings `### Editable`,
  `### Read-only context`, and `### Out of scope`.
- For `Editable` and `Read-only context`, accept Markdown bullet paths and
  strip surrounding backticks.
- Reject absolute paths, paths with `..` segments, empty entries, duplicate
  entries within the same list, and entries that resolve outside the repo.
- Do not require listed files to exist yet. New files are valid editable
  targets.
- Preserve `Out of scope` text for prompt rendering, but do not interpret it
  as paths.

## Patch scope

### Editable

- src/modes/patch/subspec.ts
- src/modes/patch/spec.ts
- test/modes/patch/subspec.test.ts
- test/modes/patch/spec.test.ts

### Read-only context

- src/modes/patch/rules.md
- docs/spec-guidance.md

### Out of scope

- Do not change index completion semantics.
- Do not change git commit behavior.

## Task checklist

- Add the `PatchScope` type and parser helper.
- Add tests for absent scope, valid scope, backticked paths, duplicate paths,
  invalid absolute paths, invalid parent traversal, new-file paths, and
  free-form out-of-scope text.
- Ensure parser errors surface as clear patch-mode failures, not unhandled
  stack traces.
- Keep this subspec parser-only; no agent invocation behavior changes yet.

## Acceptance criteria

- [ ] A tested parser extracts `editable`, `readOnly`, and `outOfScope` from
      an optional `## Patch scope` section.
- [ ] The parser rejects absolute paths and parent traversal paths.
- [ ] The parser allows new editable file paths that do not exist on disk.
- [ ] Existing specs without `## Patch scope` still parse successfully.
- [ ] Parser failures produce actionable error text naming the bad scope
      entry.
- [ ] No agent CLI invocation behavior changes in this subspec.

## Verification

- Run `bun run typecheck`.
- Run `bun test`.

## Documentation updates

- None. Subspec 00 owns the authoring docs.
