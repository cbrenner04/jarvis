# Classify Claude zero-exit quota results

Claude Code can emit a terminal JSON result with `is_error: true`,
`api_error_status: 429`, and a quota message such as “You've hit your monthly
spend limit” while exiting `0`. Jarvis currently treats every zero-exit agent
process as `ok`, so patch mode never enters quota fallback and stops without
trying the next configured agent.

Parse Claude's structured terminal result before accepting a zero exit. Treat a
semantic 429/quota result as `kind: "quota"`, preserving its diagnostics, so
the existing ordered fallback chain runs. Do not classify ordinary successful
Claude output or unrelated zero-exit structured errors as quota.

Add regression coverage at the agent spawn/classification boundary and the
patch fallback path using the exact reported output shape. Update the quota
signal documentation with the verified monthly-spend-limit sample and its
zero-exit behavior.
