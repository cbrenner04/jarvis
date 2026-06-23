---
name: migrate-accumulated-completed-specs
---

# Relocate already-accumulated v1-work specs to their correct home

## Problem

`v2/spec/completed/` holds v1-work specs parked there under the old layout. After the new
layout is settled, this backlog still sits in the wrong tree, contradicting the "v2/spec = v2
planning" model.

## Direction

Relocate the existing v1-work specs in `v2/spec/completed/` to the v1 completed home, leaving
`v2/spec/completed/` holding only genuine v2 planning. One-time backlog reconciliation
classified by what each spec changed.

## Out of scope

- Authoring and cleanup-archival routing (separate behaviors).

## Prerequisites

- The v1-work completed-spec home is established as the archival destination.
