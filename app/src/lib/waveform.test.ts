import assert from "node:assert/strict";
import test from "node:test";
import type { Segment } from "./clk";
import {
  buildBitRuns,
  buildWaveformGeometry,
  getVirtualScrollWidth,
  getWaveformChunks,
  getWaveformRenderRange,
  MAX_VIRTUAL_SCROLL_WIDTH,
  scrollLeftToViewStart,
  tickToViewportRatio,
  viewStartToScrollLeft,
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

test("virtual scroll width stays below browser layout limits", () => {
  assert.equal(getVirtualScrollWidth(480, 480, 800), 800);
  assert.equal(getVirtualScrollWidth(480, 120, 800), 3200);
  assert.equal(
    getVirtualScrollWidth(101_000_000, 20, 800),
    MAX_VIRTUAL_SCROLL_WIDTH,
  );
});

test("virtual scroll positions preserve logical timeline endpoints", () => {
  const total = 101_000_000;
  const viewSpan = 20;
  const viewportWidth = 800;
  const scrollWidth = getVirtualScrollWidth(total, viewSpan, viewportWidth);
  const maxStart = total - viewSpan;

  assert.equal(
    viewStartToScrollLeft(0, scrollWidth, viewportWidth, total, viewSpan),
    0,
  );
  assert.equal(
    viewStartToScrollLeft(
      maxStart,
      scrollWidth,
      viewportWidth,
      total,
      viewSpan,
    ),
    scrollWidth - viewportWidth,
  );
  assert.equal(
    scrollLeftToViewStart(
      scrollWidth - viewportWidth,
      scrollWidth,
      viewportWidth,
      total,
      viewSpan,
    ),
    maxStart,
  );
});

test("virtual scroll conversion round-trips a logical position", () => {
  const total = 101_000_000;
  const viewSpan = 69;
  const viewportWidth = 832;
  const scrollWidth = getVirtualScrollWidth(total, viewSpan, viewportWidth);
  const viewStart = 31_717_163;
  const scrollLeft = viewStartToScrollLeft(
    viewStart,
    scrollWidth,
    viewportWidth,
    total,
    viewSpan,
  );

  assert.ok(scrollWidth <= MAX_VIRTUAL_SCROLL_WIDTH);
  assert.ok(
    Math.abs(
      scrollLeftToViewStart(
        scrollLeft,
        scrollWidth,
        viewportWidth,
        total,
        viewSpan,
      ) - viewStart,
    ) < 1e-7,
  );
});

test("ticks map into viewport-local coordinates", () => {
  assert.equal(tickToViewportRatio(100, 100, 20), 0);
  assert.equal(tickToViewportRatio(110, 100, 20), 0.5);
  assert.equal(tickToViewportRatio(120, 100, 20), 1);
  assert.equal(tickToViewportRatio(90, 100, 20), -0.5);
});
