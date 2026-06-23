## Verdict

Four refinements required; two cosmetic items optional.

### Required

**1. Add `v2/docs/v2-vision.md` to subspec 01's scope.**
`v2/docs/v2-vision.md:24` describes the current repo layout and names `wip-intents/`. It is a live long-lived reference doc, not historical evidence — the exact class subspec 01 claims to cover. It is currently left stale with no AC catching it. Add it to the task checklist, the documentation-updates list, and the "no `wip-intents` reference remains" AC enumeration.

**2. Decide the fate of the `wipDir`/`wipDirRel` identifiers in `intent.ts`.**
The code reads the directory through `const wipDir = join(project.root, targetDir, "wip-intents")` (`intent.ts:599`). The ACs are phrased "no `wip-intents` reference remains," which a grep for the hyphenated literal satisfies even while the `wipDir`/`wipDirRel` identifiers survive — leaving code that reads `seeds/` through a variable named for the old directory. The spec must make an explicit choice: either add a decision renaming the identifiers (and an AC that guards it) or state explicitly that identifiers are out of scope. Silence is the defect. Given the spec's whole premise is that "wip" misleads, renaming is the stronger choice, but the spec must state which.

**3. Narrow AC 01's "no `wip-intents` reference" claim and carve out the self-referential seed.**
`v2/spec/wip-intents/rename-wip-intents-dir-to-seeds.md` is the raw seed *for this rename*; its filename, title, and problem statement necessarily contain `wip-intents`. Subspec 01's AC "No `wip-intents` reference remains in any file under `v2/spec/seeds/`" directly contradicts leaving that seed verbatim and is therefore unsatisfiable as written. The spec must (a) state that the raw seed body is evidence and stays verbatim, including its `[[rename-wip-intents-dir-to-seeds]]` wikilink (a slug, not a path — valid regardless of directory), and (b) narrow the AC to target `wip-intents` *path/cross-link* references, excluding the seed's own descriptive name. The blanket "update cross-links in moved seed files" decision must distinguish stale path links (fix) from the seed's self-naming (keep).

**4. Name the in-flight sibling spec tree and confirm the conventions-files no-op.**
- Subspec 01's "other dated spec trees keep their wording" decision should explicitly name the in-flight, non-completed sibling `v2/spec/2026-06-23T06-01-15Z-route-spec-authoring-by-target/` and the rationale (frozen authored-spec evidence; its conventions already landed in AGENTS.md), so an implementer does not read its retained `wip-intents/` wording as an oversight.
- The intent lists `CLAUDE.md`/`AGENTS.md` in scope, but neither contains `wip-intents`. Add one decision line stating the conventions files carry no `wip-intents` reference — nothing to update — so the divergence from the intent's stated scope is not an unexplained gap a reviewer must re-verify.

### Optional (not blocking)

- Subspec 00's "no reference remains" AC omits `v1-behaviors.md`, which is covered by its own checklist/doc-update bullets. Asymmetric enumeration, not a hole; tidy for consistency if convenient.
- `v2/docs/v1-behaviors.md:132` cites `intent-command.test.ts` for the "raw seed left in place" behavior, but the `wip-intents` literals live in `intent-command.sandbox-unrunnable.test.ts`. Pre-existing staleness; subspec 00 already edits the surrounding block, so correcting the citation is an in-scope-adjacent freebie.

### Rationale

The spec's shape is sound — pure rename, single PR, correct exclusion of `completed/` and `reports/`. The two load-bearing defects are a live doc that the grep-based ACs miss (#1) and an AC guard that cannot see a surviving stale identifier (#2) — both leave the rename half-done in ways the acceptance criteria certify as complete. #3 is a correctness defect in the AC itself: it is literally unsatisfiable against the seed it must preserve. #4 converts two "implementer guesses against the intent" gaps into stated decisions, per the principle that the spec should record load-bearing choices rather than leave them to judgment.