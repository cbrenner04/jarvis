Verdict: Refine the spec to address the following.

1. **Pin the required-role scoping rule precisely.** Decision 2 ("required, same hard-error family as other required roles") and Decision 4 ("required for every agent that defines `implement`") read as two different scoping rules — one universal-per-agent, one implement-conditional. State a single unambiguous rule: `shrink` is required using the exact same agent-scoping mechanism as the other existing required roles (no special-casing tied to `implement`). This also resolves the undefined-behavior question for an agent that defines other required roles but not `implement` — that case must fall under the same general rule, not be left implicit.

2. **Match AC wording to the intent's glob, not specific filenames.** The intent says `config/machines/*.json`; the acceptance criteria should reference that glob/pattern rather than naming `home.json`/`work.json` explicitly, so the AC doesn't silently stop covering profiles added later.

3. **State the atomic-landing decision explicitly.** Add a decision line making clear that role/type additions, load-time validation, and the required per-agent `shrink` rungs in `config/machines/*.json` land together in this one subspec/PR — not as a sequence that could leave config loading broken mid-migration. This is currently only implied by task/AC ordering.

4. **Anchor AC 1 to existing test coverage.** Per this repo's citation convention for preservation-style claims, AC 1 ("same hard-error shape as other required roles") should name the existing required-role validation test file/pattern being extended, not just assert the behavior in prose.

5. **Add a one-line disambiguation note in `role-resolution.md`** (or the affected subspec doc) clarifying that the `shrink` role (model-resolution) and the unrelated `patch_phase: "shrink"` value are separate namespaces — cheap to add, prevents reader confusion given both use the literal string "shrink."

Not required: no rung-value/strength policy should be added (the intent explicitly disclaims code-enforced rung policy — leave as authoring convention), and no `v1-behaviors.md` update is needed (this is a net-new v2-only role, not a change to existing v1 functionality).