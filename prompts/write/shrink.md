---
id: write.shrink
behavior: write
kind: fragment
revision: 1
placeholders: [BASE_REF:string!]
---
# Shrink checklist

Simplify only the diff in `<BASE_REF>..HEAD`.

- No numeric target. Shrink only where the code gets simpler without changing behavior.
- Do not regress acceptance criteria. If a simplification risks changing required behavior, leave it alone.
- Do not delete tests. Keep test coverage that proves the current behavior.
- Hunt bloat patterns: derivable fields, pass-through wrappers, dead enum/status values, 1:1 tables, repeated test input literals, docs restating signatures, and machinery with no consumer and no spec'd future consumer.
- Do not widen scope beyond files already touched by the run diff unless the active spec explicitly requires it.
