import assert from "node:assert/strict";
import test from "node:test";
import { shouldActivateEventTrack } from "./event-ui.ts";

test("event track responds to Enter and Space when it has focus", () => {
  assert.equal(shouldActivateEventTrack("Enter", true), true);
  assert.equal(shouldActivateEventTrack(" ", true), true);
});

test("event track ignores keys from nested editor controls", () => {
  assert.equal(shouldActivateEventTrack("Enter", false), false);
  assert.equal(shouldActivateEventTrack(" ", false), false);
});

test("event track ignores unrelated keys", () => {
  assert.equal(shouldActivateEventTrack("Escape", true), false);
});
