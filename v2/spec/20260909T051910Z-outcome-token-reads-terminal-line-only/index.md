# Outcome token reads the terminal line only

`parseStepOutcomeToken` falls back to a lenient last-word scan over the whole response, so a `blocked` inside summary prose after the terminal token classifies a completed subspec as blocked, the blocker reprompt finds nothing, and the run settles `missing_blocker` → `paused` → `unsupported_resume_context` over ticked criteria and a completion commit.

- [ ] [00 - Terminal-line token, completion over ticked criteria, recorded evidence](./00-terminal-line-token-and-evidence.md)
