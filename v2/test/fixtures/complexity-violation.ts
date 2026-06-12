// This file demonstrates a cognitive complexity violation.
// It's in the v2/test/fixtures directory which is ignored from regular checks,
// but can be verified out-of-band to prove the rule works.

export function overComplexFunction(x: number, y: number, z: number): number {
  if (x > 0) {
    if (y > 0) {
      if (z > 0) {
        if (x > y) {
          if (y > z) {
            if (z > 0) {
              if (x + y > z) {
                if (y + z > x) {
                  if (x + z > y) {
                    if (x > 10) return 1;
                    else if (y > 10) return 2;
                    else if (z > 10) return 3;
                    else return 4;
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  return 0;
}
