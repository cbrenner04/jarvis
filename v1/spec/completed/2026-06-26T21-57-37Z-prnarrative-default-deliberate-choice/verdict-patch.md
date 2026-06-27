The implementation satisfies all stated acceptance criteria. Reviewing the findings:

**Finding 1 (call-site `?? "template"` fallbacks not in user-facing doc):** The spec explicitly required these to be "acknowledged in the spec" — not in the user-facing doc. The Decision section does acknowledge them. The function-parameter fallbacks are internal dead code on any valid config path. No gap against the spec's stated requirement.

**Finding 2 (migration note prominence):** A dedicated `#### Existing config migration` subsection exists in `worktrees-and-commits.md` and is substantively complete. Stylistic concern only.

**Finding 3 (plan-mode template narrative has no integration test coverage):** Pre-existing gap confirmed — no plan-mode template test existed before this change. The spec required preserving existing coverage, not creating new coverage. Not introduced here.

**Finding 4 (v2/docs/v1-behaviors.md mode-specific bullets don't independently name the default):** The shared module bullet — which a reader of the PR narrative section encounters first — records `agent (default)` and the tradeoff. The spec required "record the new default, the surfaces it holds on, and the tradeoff" — the shared bullet satisfies this. The per-surface bullets are supplementary behavioral descriptions. Not a gap against the spec AC.

**Finding 5 (test comment implies untested agent-mode call count):** Pre-existing coverage gap, not introduced by this change.

---

**Verdict: no required outcomes.** All acceptance criteria are met. The core code changes (DEFAULT_CONFIG, omit-fallbacks) are correct on all three surfaces named in the spec. Tests are properly swept and pin `template` where needed. Docs record the new default, the tradeoff, the override path, and the migration step. The remaining observations are pre-existing gaps or stylistic concerns that do not violate the spec's stated requirements.