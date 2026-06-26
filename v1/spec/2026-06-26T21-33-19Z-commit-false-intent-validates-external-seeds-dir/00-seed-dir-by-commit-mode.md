# Resolve seed-input dir by commit mode

## Problem

In `v1/src/commands/intent.ts`, the file-seed validation (~L599-603) always
resolves the seeds dir to in-repo `project.root/<targetDir>/seeds`:

```ts
const seedDir = join(project.root, targetDir, "seeds");
if (inv.mode === "file" && !isPathInside(seedDir, inv.seedPath)) {
  opts.io.stderr(`intent: raw seed files must live under ${targetDir}/seeds/\n`);
  return 1;
}
```

Under `commit: false` the operator-authored seed home lives externally at
`~/.jarvis/specs/<projectSafeId>/seeds/` (= `join(externalRoot, "seeds")`, the
same `externalRoot` the no-commit branch already computes at ~L611-612). A seed
in the documented external location can never satisfy the in-repo check, so
file-mode `intent` is unusable for any `commit: false` project (intake #529,
observed on `groceries-client`).

## Decisions

- For `commit === false`, validate against `join(externalRoot, "seeds")`; the
  external seed home is the only active seeds dir for that mode — rules out
  accepting either location, which would let in-repo seeds silently bypass the
  external home the no-commit pipeline reads from.
- Compute `externalRoot` once and reuse it for both validation and the
  existing no-commit branch — rules out duplicating the
  `join(jarvisConfigDir, "specs", computeProjectSafeId(project))` derivation.
- `commit === true` keeps validating against in-repo `project.root/<targetDir>/seeds`.
- The stderr message names the active seeds dir for the resolved mode so the
  rejection points at a location that can actually satisfy the check.

## Task checklist

- [ ] Select the seed-input dir by resolved `commit` mode: external
  `join(externalRoot, "seeds")` when `commit === false`, in-repo otherwise.
- [ ] Reuse the single `externalRoot` derivation for validation and the
  no-commit branch.
- [ ] Update the rejection message to reflect the active seeds dir.
- [ ] Update the existing `intent-command.sandbox-unrunnable.test.ts` case that
  places a `commit: false` file seed in the in-repo dir so it places the seed in
  the external seeds dir; add/keep a case proving an in-repo seed is rejected
  under `commit: false`.
- [ ] Update `v1/docs/intent-mode.md` and `v2/docs/v1-behaviors.md` for the
  commit-mode-dependent seed-input dir.

## Acceptance criteria

- [ ] Under `commit: false`, `jarvis1 intent --repo <proj> <seed-file>` accepts a
  file seed located under `~/.jarvis/specs/<projectSafeId>/seeds/` and proceeds
  to the split flow instead of rejecting with `raw seed files must live under`.
- [ ] Under `commit: false`, a file seed located in the in-repo
  `project.root/<targetDir>/seeds` is rejected.
- [ ] Under `commit: true`, file-seed validation against in-repo
  `project.root/<targetDir>/seeds` is unchanged (existing committed-mode seed
  test stays green).
- [ ] `v1/docs/intent-mode.md` and `v2/docs/v1-behaviors.md` state that the
  file-seed input dir is the external seeds home under `commit: false` and the
  in-repo seeds dir under `commit: true`.

## Documentation updates

- `v1/docs/intent-mode.md` — file-seed location is commit-mode-dependent.
- `v2/docs/v1-behaviors.md` — amend the seed-input-check entries (currently
  "File seeds must live under `<targetDir>/seeds/`" and the `--target-dir`
  seed-input-check note) to record the external-vs-in-repo resolution.
