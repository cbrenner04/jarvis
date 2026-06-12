// This file demonstrates a shared import boundary violation.
// shared code should not import from v1 or v2.
// It's in the v2/test/fixtures directory which is ignored from regular checks,
// but can be verified out-of-band to prove the rule works.

import { something } from "v1/src/something.ts";

export function testFunction(): void {
  console.log(something);
}
