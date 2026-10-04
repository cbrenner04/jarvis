import { expect, test } from "bun:test";
import { completionPublishLaneRepublishFields } from "./write-loop.ts";

test("completionPublishLaneRepublishFields forwards the opt-in only when it is exactly true", () => {
  expect(completionPublishLaneRepublishFields({ allowLanePrRepublish: true })).toEqual({ allowLanePrRepublish: true });
  expect(completionPublishLaneRepublishFields({ allowLanePrRepublish: false })).toEqual({});
  expect(completionPublishLaneRepublishFields({})).toEqual({});
});
