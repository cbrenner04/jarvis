---
name: ipc-transport-dead-health-status-removal
---

# Remove transport-level health/status fallback

## Problem

`v2/src/ipc/server.ts` (`dispatchRequest`, lines 79-88) hardcodes `health`/
`status` responses reached only when `handlers?.[method]` is undefined. The
daemon always registers its own `health`/`status` handlers, so this fallback
is dead in production.

## Direction

Delete the transport-level `health`/`status` cases; daemon handlers remain
the only source of these responses.

## Decisions

- Delete rather than keep as a safety net — rules out preserving unreachable
  fallback code "just in case" a future transport consumer skips handler
  registration.

## Prerequisites
