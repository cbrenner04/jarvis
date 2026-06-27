## Verdict

The spec's core design is sound — select the seed-input dir by resolved commit mode, reuse the single `externalRoot`, leave `commit:true` untouched. The following refinements are required before the record is honest about consequences the implementation already entails.

**1. Record the accept→reject inversion for in-repo `commit:false` seeds in the decision ledger.**
The change flips an existing behavior: today a `commit:false` file seed placed in the *in-repo* seeds dir is **accepted**; after this change it is **rejected**. The decision ledger never names this inversion. Add an explicit decision entry stating it. Additionally, the existing test currently named to assert this case is "preserved" will become false — its name must be changed (not just its seed relocated) so it describes what it actually proves. This is the exact failure mode spec guidance warns against: a preservation-named test whose name lies after the change.

**2. Record that `--target-dir` no longer influences the no-commit seed-input dir.**
The old check resolved `join(project.root, targetDir, "seeds")` — `targetDir`-dependent. The new external dir (`join(externalRoot, "seeds")`) has no `targetDir` component, so `--target-dir` stops affecting the `commit:false` seed-input check entirely. `v2/docs/v1-behaviors.md` currently documents the opposite ("no-commit runs apply `--target-dir` only to the seed-input check"); that statement becomes false. Add a decision entry naming this consequence, and make the v1-behaviors documentation AC require that the specific line documenting `--target-dir`'s effect on the no-commit seed check be corrected — not vaguely "amended."

**3. Reword the rationale: the check is a placement-convention guard, not a functional read-path gate.**
The seed content is read directly from the passed path; the pipeline never enumerates the seeds dir, so an in-repo seed would not "silently bypass" any read path. The decision (reject in-repo under `commit:false`) is correct, but the *why* clause must say the rejection enforces the documented seed-home convention for the mode, not that it prevents a functional bypass.

**4. Add an acceptance criterion pinning the rejection message.**
Current ACs only assert the in-repo `commit:false` seed "is rejected" — an implementation could leave the stale message pointing at `${targetDir}/seeds/`, which under `commit:false` names a location that can never satisfy the check (the original #529 failure, reversed), and still pass. Add an AC: under `commit:false`, the rejection message names the active external seeds home (`~/.jarvis/specs/<projectSafeId>/seeds/`).

**Not required:** a dedicated non-git-root AC. The new validation is a pure path check (`isPathInside` on a `jarvisConfigDir`-derived path) with no git dependency, and existing coverage already exercises a non-git `commit:false` root; a dedicated criterion would be redundant.