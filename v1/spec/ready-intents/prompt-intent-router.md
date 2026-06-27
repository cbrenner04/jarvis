---
name: prompt-intent-router
---

# jarvis "<intent>" classifies the prompt or exits asking for a better one

## Problem

There is no `jarvis "<intent>"` entry point. The seed wants a prompt-first
controller where the prompt carries only intent and jarvis owns routing. The
first decision in that loop is: what does this prompt mean?

## Direction

Add `jarvis "<text>"` as a controller entry. Parse the natural-language prompt
and classify it into exactly one route: a new intent to start, a resume of an
existing job/seed/intent, or unroutable. Routing is conservative: jarvis only
dispatches when it is certain. When it is not 100% sure how to route, it exits
non-zero with a summary of why it could not route and asks the operator to
sharpen the prompt — it never guesses a route. Dispatch of the new and resume
routes is the seam later slices fill; this slice owns classification and the
unroutable exit. No freeform chat — a single classification pass, not a
conversation.

## Documentation updates

- `v1/docs/` controller reference — document the entry point, the three route
  outcomes, and the conservative-routing / improve-your-prompt exit.
- `v2/docs/v1-behaviors.md` — record the routing contract (new net-new behavior).

## Prerequisites
