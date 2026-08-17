- Define the authorship contract. Staged Markdown has no provenance, so either reserve `Artifact contract check failed:` as a harness-only marker or add an observable way to distinguish authorship. Guarantees about preserving agent blockers must cover all non-reserved agent blockers without implying that a marker-prefixed agent block can be distinguished today.

- Specify canonical diagnostic semantics: what portion of each removed section reaches the prompt, how multiline bodies and whitespace are represented, how multiple diagnostics are delimited, whether empty marker bodies qualify, and how staged-file order is preserved. Tests must pin this representation.

- Clarify diagnostic lifetime. Clearing before prompt rendering creates a loss window if rendering or invocation fails. Require either retention/recovery for a later attempt or explicitly limit availability to the current redraft attempt and align documentation and tests with that guarantee.

- Add regression coverage for the real failure chain: normalizer rejection appends multiple blockers, the stage is preserved, the next attempt clears them, forwards every reason in order, and a valid redraft completes without `plan.draft.blocker`. A fixture that begins with manually preseeded blockers alone does not protect this integration seam.

- Cover every preserved-attempt prompt branch, including the staged-Markdown lint reprompt path. Ordered diagnostics must reach whichever redraft prompt is rendered after clearing; otherwise the stated “every reason” contract is incomplete.

- Make mutation checkpoints correspond to observable guards and their actual pinning tests. Heading recognition, prefix matching, section removal, diagnostic forwarding, and mixed-blocker preservation must each have correctly linked directives where guards change; prompt-forwarding mutations should not rely on an unrelated broadly titled stripping test. Retain exactly one valid keystone checkpoint for the headline baseline reversal.

These refinements are required by the intent’s ordered-diagnostic and genuine-blocker guarantees and by the spec guidance’s failing-regression, guard-mutation, and keystone requirements. The work remains one atomic execution-loop subspec; no split is required.
