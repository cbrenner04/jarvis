---
id: shared.pr-description
behavior: shared-pr-description
kind: fragment
revision: 3
---
Author a PR description consisting of a short summary followed by a `Decisions:` section. Wrap your response in literal `<<<PR_DESCRIPTION_BEGIN>>>` and `<<<PR_DESCRIPTION_END>>>` sentinels. Emit no content outside the sentinels.

<<<PR_DESCRIPTION_BEGIN>>>
<Description — short and sweet but enough to describe the work>

Decisions:
<unordered list of notable decisions>
<<<PR_DESCRIPTION_END>>>

The Description should be concise but useful. The Decisions list should capture what mattered in the choice. Let the model decide what's appropriate for each.
