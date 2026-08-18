import assert from "node:assert/strict";
import test from "node:test";
import type { Segment } from "./clk";
import {
  buildBitRuns,
  buildWaveformGeometry,
  getMinimumViewSpan,
  getWaveformChunks,
  getWaveformRenderRange,
  isTimelinePointerX,
  MAX_WAVEFORM_WIDTH,
} from "./waveform.ts";

function segment(word: number, duration: number, instance: number): Segment {
  return { word, duration, instance, pattern: "&TEST" };
}

test("adjacent segments with the same bit value become one run", () => {
  const runs = buildBitRuns(
    [segment(0, 2, 0), segment(0, 3, 1), segment(1, 4, 2)],
    0,
  );

  assert.deepEqual(runs, [
    { start: 0, end: 5, value: 0 },
    { start: 5, end: 9, value: 1 },
  ]);
});

test("a transition on a display-bin boundary remains exact", () => {
  const runs = buildBitRuns([segment(0, 5, 0), segment(1, 5, 1)], 0);
  const geometry = buildWaveformGeometry(runs, 0, 10, 5);

  assert.deepEqual(geometry.mixed, []);
  assert.equal(geometry.path, "M 0 28 H 500 V 8 H 1000");
});

test("unresolvable alternating values become a merged mixed range", () => {
  const runs = buildBitRuns(
    Array.from({ length: 10 }, (_, index) => segment(index % 2, 1, index)),
    0,
  );
  const geometry = buildWaveformGeometry(runs, 0, 10, 5);

  assert.deepEqual(geometry.mixed, [{ start: 0, end: 10 }]);
  assert.equal(geometry.path, "");
});

test("waveform chunks cover half a viewport on both sides", () => {
  const chunks = getWaveformChunks(1000, 400, 100);

  assert.equal(chunks[0].start, 340);
  assert.equal(chunks.at(-1)?.end, 560);
  assert.ok(chunks.every((chunk) => chunk.end - chunk.start <= 20));
});

test("chunk identities stay stable until scrolling crosses a boundary", () => {
  const at400 = getWaveformChunks(1000, 400, 100).map((chunk) => chunk.index);
  const at405 = getWaveformChunks(1000, 405, 100).map((chunk) => chunk.index);
  const at421 = getWaveformChunks(1000, 421, 100).map((chunk) => chunk.index);

  assert.deepEqual(at405, at400);
  assert.notDeepEqual(at421, at400);
});

test("adjacent chunk render ranges overlap by one display pixel", () => {
  const resolution = 2;
  const left = getWaveformRenderRange({ start: 20, end: 40 }, 100, resolution);
  const right = getWaveformRenderRange(
    { start: 40, end: 60 },
    100,
    resolution,
  );

  assert.deepEqual(left, { start: 19, end: 41 });
  assert.deepEqual(right, { start: 39, end: 61 });
  assert.equal(left.end - right.start, resolution);
});

test("chunk render overlap stays inside the complete timeline", () => {
  assert.deepEqual(getWaveformRenderRange({ start: 0, end: 20 }, 100, 2), {
    start: 0,
    end: 21,
  });
  assert.deepEqual(getWaveformRenderRange({ start: 80, end: 100 }, 100, 2), {
    start: 79,
    end: 100,
  });
});

test("minimum view span keeps the waveform inside the layout width limit", () => {
  const total = 1_080_750;
  const viewportWidth = 950;
  const span = getMinimumViewSpan(total, viewportWidth);

  assert.equal(span, 86);
  assert.ok((viewportWidth * total) / span <= MAX_WAVEFORM_WIDTH);
});

test("minimum view span retains the 20 tick floor for short timelines", () => {
  assert.equal(getMinimumViewSpan(480, 950), 20);
  assert.equal(getMinimumViewSpan(12, 950), 12);
  assert.equal(getMinimumViewSpan(0, 950), 0);
});

test("minimum view span scales for very large timelines", () => {
  const total = 101_000_000;
  const viewportWidth = 800;
  const span = getMinimumViewSpan(total, viewportWidth);

  assert.equal(span, 6734);
  assert.ok((viewportWidth * total) / span <= MAX_WAVEFORM_WIDTH);
});

test("zoom selection starts only to the right of waveform labels", () => {
  assert.equal(isTimelinePointerX(81.9, 950, 82), false);
  assert.equal(isTimelinePointerX(82, 950, 82), true);
  assert.equal(isTimelinePointerX(949.9, 950, 82), true);
  assert.equal(isTimelinePointerX(950, 950, 82), false);
});
