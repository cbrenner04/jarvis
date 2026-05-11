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
- **Status checks**: After the first successful **`CI / checks`** run on
  `main`, add that context to `required_status_checks.contexts`. GitHub rejects
  unknown check names when creating protection.

## Plan restriction (free private repository)

Branch protection (and reading protection via the API) is **not available** for
**private** repositories on the **free** GitHub plan. The API returns HTTP 403
with a message to upgrade to GitHub Pro or make the repository **public**.

## Blocker

`GET /repos/cbrenner04/jarvis/branches/main/protection` returned **403** on the
current private/free plan. Complete the tasks below after the repository is
**public** or on a **paid** plan (or apply equivalent rules in the UI if API
access remains blocked).

**Options**:

1. Make the repository **public** (then re-run the `gh api` commands below), or
2. Upgrade the account/org to **GitHub Pro** (or use a paid org), or
3. Enforce process manually (required reviews and green CI as social contract)
   until the plan supports protection.

## Tasks

- [ ] When the repo qualifies (public or Pro), ensure **`CI / checks`** has
      succeeded on `main` at least once so the check name exists.
- [ ] Apply protection with `gh` (JSON body—see below). Adjust
      `required_approving_review_count` if you want stricter review.
- [ ] Re-run `gh api repos/{owner}/{repo}/branches/main/protection` and confirm
      `enforce_admins` is disabled so admins retain bypass.

## Example `gh api` invocation

Replace `OWNER/REPO` if needed. Run from an authenticated `gh` session with
`repo` scope.

```bash
OWNER_REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
# After CI has run on main and "CI / checks" appears under branch checks:
gh api --method PUT "repos/${OWNER_REPO}/branches/main/protection" \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["CI / checks"]
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

- `main` requires the `CI / checks` status and at least one approval including
  code owners (where GitHub applies that rule).
- Repository admins can still merge or override when required (admin bypass).

## Documentation updates

- [x] In [../../README.md](../../README.md), document the plan gate (public or
      Pro for branch protection) and point to this subspec for the exact `gh`
      steps.
