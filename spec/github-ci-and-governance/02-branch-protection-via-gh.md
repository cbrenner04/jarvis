# 02 - Branch protection via `gh`

## Problem

CI and CODEOWNERS are stronger when `main` requires green checks and code-owner
review, while the repository owner can still bypass rules when necessary (for
example an urgent hotfix).

## Decisions

- **Tooling**: `gh api` against GitHub’s branch-protection REST API (no extra
  plugins).
- **Default branch**: `main` (verify with `gh repo view --json
  defaultBranchRef`).
- **Admin bypass**: **`enforce_admins`: `false`** in the protection payload so
  administrators are **not** subject to the same restrictions and can short-circuit
  required checks when needed. (In the web UI this corresponds to not enforcing
  rules on admins / allowing admin bypass—wording depends on GitHub edition.)
- **Code owners**: `require_code_owner_reviews`: `true` with at least one
  required approval so `CODEOWNERS` is meaningful once protection is enabled.
- **Status checks**: Use the **check run `name`** GitHub attaches to the commit
  (often the workflow job id, e.g. `checks` in this repo). Discover it after one
  green CI run on `main`:

  ```bash
  gh api repos/OWNER/REPO/commits/main/check-runs -q '.check_runs[].name'
  ```

  GitHub rejects unknown context names when creating protection.

## Plan note (private repositories)

Branch protection is **not available** for **private** repositories on the
**free** GitHub plan (API **403** until the repo is **public** or on a **paid**
plan).

## Tasks

- [x] When the repo qualifies (public or Pro), ensure the CI job has succeeded
      on `main` at least once so the check name exists.
- [x] Apply protection with `gh` (JSON body—see below). Adjust
      `required_approving_review_count` if you want stricter review.
- [x] Re-run `gh api repos/{owner}/{repo}/branches/main/protection` and confirm
      `enforce_admins.enabled` is **false** in the response so admins retain bypass.

## Example `gh api` invocation

Replace `OWNER/REPO` if needed. Run from an authenticated `gh` session with
`repo` scope. Set `contexts` to the check name(s) from `check-runs` (this repo
uses **`checks`**).

```bash
OWNER_REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
# After CI has run on main:
gh api --method PUT "repos/${OWNER_REPO}/branches/main/protection" \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["checks"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": true,
    "required_approving_review_count": 1
  },
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": false,
  "lock_branch": false,
  "allow_fork_syncing": false
}
EOF
```

Confirm field names against the [branch protection REST
API](https://docs.github.com/en/rest/branches/branch-protection) if GitHub
returns a validation error.

## Acceptance criteria

- `main` requires the **`checks`** status and at least one approval including code
  owners (where GitHub applies that rule).
- Repository admins can still merge or override when required (admin bypass).

## Documentation updates

- [x] In [../../README.md](../../README.md), document the plan gate (public or
      Pro for branch protection) and point to this subspec for the exact `gh`
      steps.
