**Verdict: One required outcome.**

Add test coverage for a case where the body's first line starts with `name:` but does not match the intent's actual slug (e.g., `name: value pairs are validated before...`). This body should end up with the derived `# <Title>` heading prepended, and the original `name:`-prefixed line preserved unchanged as body prose (not replaced or deleted).

**Rationale:** The spec's anchoring decision was deliberately chosen over a generic `name:\s*.*` match specifically to avoid clobbering legitimate prose that happens to start with "name:". The current test suite's "missing heading" case uses prose that doesn't start with `name:` at all, so it never exercises the exact scenario the anchoring decision exists to protect — the behavior is implemented correctly but unverified. This is a direct, cheap gap against the verdict-plan's stated rationale for point 3 and should be closed before this spec is considered fully covered.

No other changes required — the heading-level check (`#` vs `##`) and the double-mismatch edge case are legitimate but out of scope for this spec's documented decision branches and can be deferred.