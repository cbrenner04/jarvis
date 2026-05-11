# Quota Signals

Jarvis classifies quota exhaustion after an agent CLI exits non-zero. Exit codes
are not documented as stable by the vendors, so the implementation treats the
exit code as a guard (`0` is never quota) and matches the stderr text that each
CLI surfaces for plan, rate, or spend limits.

## Claude

- Observed/documented exit code: non-zero; exact value is not documented.
- Stderr/stdout text: Claude Code documents usage-limit messages such as
  `You've hit your session limit`, `You've hit your weekly limit`, and
  `You've hit your Opus limit`, each with a reset time.
- Distinguishable: yes. Claude Code documents these under usage limits and
  separately lists authentication, server, request, and network errors.
- Source: Claude Code error reference:
  https://code.claude.com/docs/en/errors

Chosen matcher: non-zero exit plus one of the documented usage-limit messages.
`Credit balance is too low` and `Request rejected (429)` are also treated as
quota-like because Claude documents them in the same usage-limits section.

## Codex

- Observed/documented exit code: non-zero; exact value is not documented.
- Stderr/stdout text: OpenAI documents that when Codex usage limits are reached,
  Codex cannot be used until the usage window resets. Community and issue
  reports commonly surface this as `You've reached your usage limit` or
  `You've hit your usage limit`.
- Distinguishable: mostly. Plain `usage limit` text is distinct from auth and
  network failures. `rate_limit_exceeded` is quota/rate related but can represent
  a temporary rate limit rather than a plan window; Jarvis still treats it as a
  quota signal so the fallback loop can try another agent.
- Sources:
  - OpenAI Help Center, Codex usage limits:
    https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan/
  - OpenAI Codex issue mentioning `rate_limit_exceeded`:
    https://github.com/openai/codex/issues/690

Chosen matcher: non-zero exit plus `You've reached your usage limit`,
`You've hit your usage limit`, usage-limit text that mentions a reset/window, or
`rate_limit_exceeded`.

## Cursor

- Observed/documented exit code: non-zero; exact value is not documented.
- Stderr/stdout text: Cursor account docs say the editor explicitly notifies
  users when included monthly usage is exceeded. Cursor-agent issue reports show
  errors such as `Error: You've hit your usage limit`, `You've hit your free
  requests limit`, `Total usage limit reached`, and `monthly Cursor usage
  limit`. Concurrent CLI runs may also surface `ConnectError:
  [resource_exhausted] Error`.
- Distinguishable: partly. Direct usage/spend-limit messages are
  distinguishable. `[resource_exhausted]` is ambiguous between Cursor account
  limits, model/provider limits, and concurrency throttles, but it means the
  current agent cannot make progress because a resource limit was reached.
- Sources:
  - Cursor account limits docs:
    https://docs.cursor.com/account/rate-limits
  - Cursor issue with cursor-agent usage-limit output:
    https://github.com/cursor/cursor/issues/3703
  - Cursor forum report with `resource_exhausted`:
    https://forum.cursor.com/t/cursor-agent-cli-concurrent-call-limit/144782

Chosen matcher: non-zero exit plus direct usage/free-request/monthly/spend-limit
phrases, or `resource_exhausted`.

## Opencode

- Observed/documented exit code: non-zero; exact value depends on the provider
  surfaced through opencode.
- Stderr/stdout text: opencode can wrap multiple providers, so initial matching
  is conservative and based on common provider error text: `rate limit`, `quota
  exceeded`, `insufficient_quota`, `429` on an error line, and `you have
  exceeded your`.
- Model configuration text: `model not found`, `unknown model`, `unsupported
  model`, `invalid model`, and opencode's `no provider configured for` phrasing.
- Distinguishable: partly. Direct quota and model-configuration messages are
  distinguishable, but provider-specific quota surfaces vary. This list is
  expected to grow as real-world opencode failures are observed.

Chosen matcher: non-zero exit plus one of the direct quota phrases above, or
`429` when it appears on an error-like line.

## AirProxy

- Observed/documented exit code: non-zero; exact value depends on opencode and
  the AirProxy sidecar response.
- Stderr/stdout text: AirProxy uses the generic opencode matcher plus provider
  lines containing `airproxy` with `limit` or `denied`, and lines containing
  both `403` and `forbidden`.
- Model configuration text: the generic opencode model-configuration matcher
  plus `unknown provider: airproxy`.
- Distinguishable: partly. Direct AirProxy limit and denial messages are useful
  fallback signals, but upstream auth failures can be surfaced through generic
  HTTP text.

Chosen matcher: non-zero exit plus the generic opencode quota matcher, an
AirProxy line containing `limit` or `denied`, or a line containing both `403`
and `forbidden`.

## Copilot

- Observed/documented exit code: non-zero; exact value depends on opencode and
  GitHub Copilot's provider response.
- Stderr/stdout text: Copilot uses the generic opencode matcher plus provider
  lines containing `copilot` with `limit` or `quota`, and the observed phrase
  `you have exceeded your monthly`.
- Model configuration text: the generic opencode model-configuration matcher
  plus `unknown provider: github-copilot`.
- Distinguishable: partly. Direct Copilot limit and quota messages are useful
  fallback signals, but opencode may still surface provider failures in a
  generic format.

Chosen matcher: non-zero exit plus the generic opencode quota matcher, a
Copilot line containing `limit` or `quota`, or `you have exceeded your monthly`.
