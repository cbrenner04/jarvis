/**
 * Loose normalization for repo URLs and slugs.
 *
 * Goal: collapse the common Git remote-URL shapes (HTTPS, SSH, scp-like SSH,
 * `owner/repo` slug) into a single canonical lower-case `host/owner/repo`
 * string that can be compared with `===`.
 *
 * Examples (all normalize to `github.com/org/repo`):
 *   - `https://github.com/Org/Repo`
 *   - `https://github.com/org/repo.git`
 *   - `git@github.com:Org/Repo.git`
 *   - `ssh://git@github.com/org/repo.git`
 *   - `org/repo`  (bare slug, assumed `github.com`)
 */

const SLUG_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*\/[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

export function normalizeRepoUrl(input: string): string | undefined {
  const trimmed = input.trim();
  if (trimmed === "") {
    return undefined;
  }

  // Bare slug: `owner/repo`. Treat as github.com.
  if (SLUG_RE.test(trimmed)) {
    return `github.com/${stripDotGit(trimmed).toLowerCase()}`;
  }

  let rest = trimmed;

  // Strip leading protocol (https://, http://, ssh://, git://).
  rest = rest.replace(/^(?:https?:\/\/|ssh:\/\/|git:\/\/)/i, "");

  // Strip leading user (e.g. git@). Only at the very start of what remains.
  rest = rest.replace(/^[A-Za-z0-9._-]+@/, "");

  // SSH scp-like form: host:owner/repo → host/owner/repo. Replace the first
  // `:` after the host with `/`. Only do this when no `/` precedes the `:`.
  const colonIdx = rest.indexOf(":");
  const firstSlash = rest.indexOf("/");
  if (colonIdx !== -1 && (firstSlash === -1 || colonIdx < firstSlash)) {
    rest = `${rest.slice(0, colonIdx)}/${rest.slice(colonIdx + 1)}`;
  }

  // Strip trailing slashes and `.git` suffix.
  rest = rest.replace(/\/+$/, "");
  rest = stripDotGit(rest);

  // Lowercase the whole thing for case-insensitive comparison.
  rest = rest.toLowerCase();

  // Require at least host/owner/repo (two slashes).
  const parts = rest.split("/").filter((p) => p.length > 0);
  if (parts.length < 3) {
    return undefined;
  }
  // Keep host + first two path segments. Anything beyond (e.g. `/tree/main`)
  // is dropped on the assumption that loose URL matching ignores trailing
  // metadata. We keep this conservative: only the first three segments are
  // canonical.
  return parts.slice(0, 3).join("/");
}

function stripDotGit(s: string): string {
  return s.endsWith(".git") ? s.slice(0, -4) : s;
}

export function repoUrlsEqual(a: string, b: string): boolean {
  const na = normalizeRepoUrl(a);
  const nb = normalizeRepoUrl(b);
  if (na === undefined || nb === undefined) {
    return false;
  }
  return na === nb;
}
