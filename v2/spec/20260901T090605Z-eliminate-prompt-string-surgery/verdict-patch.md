Verifying the active-subspec spacing change and subspec scope before issuing the verdict.
## Verdict

### Required outcomes

1. **Restore v1 active-subspec path/body spacing for non-empty paths.** Subspec 04 only migrated optional-section omission to `renderArtifactTemplate` trim-based emptiness; it did not authorize changing how a present active subspec is formatted. Pre-migration v1 `buildPrompt` appended a trailing newline to non-empty `ACTIVE_SUBSPEC_PATH`, which produced a blank line between the path and body inside `<<<ACTIVE_SUBSPEC_*>>>` (the template already separates the placeholders on adjacent lines). The migration now passes the path verbatim, collapsing that blank line. v2 write-step assembly still supplies `` `${path}\n` `` for non-empty paths (`v2/docs/write-behavior.md`), so v1 patch prompts with an active subspec now diverge from both pre-migration v1 and current v2 on a path the harness exercises. **Outcome:** when `buildPrompt` is called with a non-empty `activeSubspecPath`, rendered output must again include the blank line between the path line and subspec body. Pin it in an existing or new test/snapshot so the spacing cannot regress without a failing check.

### Not required (spec-backed or out of scope)

- **Whitespace-only `activeSubspecPath` omits the whole `## Active Subspec` block** — intentional per subspec 04 and the added `v2/docs/v1-behaviors.md` note; not a regression.
- **Asymmetric variant resolvers (`resolveDeclaredPlanSpecLayoutVariant` vs `resolvePlanSpecLayoutVariant`)** — matches subspec 02: layout variants apply only when the artifact declares them; debate templates without variant frontmatter correctly ignore layout opts.
- **Narrow prompt-surgery guard and CRLF `split`/`join` rewrites in `review.ts`** — guard scope and forbidden-token list match subspec 05; the rewrites are in intent-validation helpers, not assembled-prompt output.
- **`TARGET_DIR` required but inert in default prose** — nested layout is delivered via variant substitution at render time per subspec 00; default `targetDir === "spec"` omits the variant by design.
- **Render-observer map gaps and `v2/docs/prompts.md` reserved-variant wording** — reasonable hygiene follow-ups; not acceptance-criteria or subspec documentation obligations for this patch.