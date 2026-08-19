import assert from "node:assert/strict";
import test from "node:test";
import type { Segment } from "./clk.ts";
import {
  aggregateSingleRowPatternRuns,
  buildInstanceRanges,
  instanceForTick,
} from "./output-sequence.ts";

const segment = (
  duration: number,
  instance: number,
  pattern = "&PATTERN",
): Segment => ({ duration, instance, pattern, word: 1 });

test("consecutive single-row pattern invocations are aggregated", () => {
  assert.deepEqual(
    aggregateSingleRowPatternRuns([
      segment(2, 0),
      segment(2, 1),
      segment(2, 2),
    ]),
    [
      {
        ...segment(6, 0),
        count: 3,
        first: true,
      },
    ],
  );
});

test("multi-row pattern invocations remain separate", () => {
  const segments = [segment(2, 0), segment(3, 0)];
  assert.deepEqual(aggregateSingleRowPatternRuns(segments), [
    { ...segments[0], count: 1, first: true },
    { ...segments[1], count: 1, first: false },
  ]);
});

test("instance ranges resolve ticks to their outp invocation", () => {
  const ranges = buildInstanceRanges([
    segment(2, 0),
    segment(3, 0),
    segment(4, 1),
  ]);
  assert.deepEqual(ranges, [
    { end: 5, instance: 0 },
    { end: 9, instance: 1 },
  ]);
  assert.equal(instanceForTick(ranges, 0), 0);
  assert.equal(instanceForTick(ranges, 4), 0);
  assert.equal(instanceForTick(ranges, 5), 1);
  assert.equal(instanceForTick(ranges, 8), 1);
});
