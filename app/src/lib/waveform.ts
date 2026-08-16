import type { Segment } from "./clk";

export type BitValue = 0 | 1;

export type BitRun = {
  start: number;
  end: number;
  value: BitValue;
};

export type TickRange = {
  start: number;
  end: number;
};

export type WaveformGeometry = {
  path: string;
  mixed: TickRange[];
};

export type WaveformChunk = TickRange & {
  index: number;
};

const CHUNKS_PER_VIEW = 5;
const OVERSCAN_VIEWS = 0.5;

export function getWaveformChunks(
  total: number,
  viewStart: number,
  viewSpan: number,
): WaveformChunk[] {
  if (total <= 0 || viewSpan <= 0) return [];

  const chunkSpan = viewSpan / CHUNKS_PER_VIEW;
  const renderStart = Math.max(0, viewStart - viewSpan * OVERSCAN_VIEWS);
  const renderEnd = Math.min(
    total,
    viewStart + viewSpan * (1 + OVERSCAN_VIEWS),
  );
  const first = Math.floor(renderStart / chunkSpan);
  const last = Math.max(first, Math.ceil(renderEnd / chunkSpan) - 1);
  const chunks: WaveformChunk[] = [];

  for (let index = first; index <= last; index++) {
    const start = index * chunkSpan;
    const end = Math.min(total, start + chunkSpan);
    if (end > start) chunks.push({ index, start, end });
  }
  return chunks;
}

export function buildBitRuns(segments: Segment[], bit: number): BitRun[] {
  const runs: BitRun[] = [];
  let tick = 0;

  for (const segment of segments) {
    const start = tick;
    tick += segment.duration;
    if (tick <= start) continue;

    const value = ((segment.word >>> bit) & 1) as BitValue;
    const previous = runs.at(-1);
    if (previous?.value === value && previous.end === start) {
      previous.end = tick;
    } else {
      runs.push({ start, end: tick, value });
    }
  }

  return runs;
}

function runsInRange(runs: BitRun[], start: number, end: number): BitRun[] {
  let low = 0;
  let high = runs.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (runs[middle].end <= start) low = middle + 1;
    else high = middle;
  }

  const selected: BitRun[] = [];
  for (let index = low; index < runs.length; index++) {
    const run = runs[index];
    if (run.start >= end) break;
    selected.push({
      start: Math.max(start, run.start),
      end: Math.min(end, run.end),
      value: run.value,
    });
  }
  return selected;
}

function mixedRangesFor(
  runs: BitRun[],
  start: number,
  end: number,
  resolution: number,
): TickRange[] {
  if (resolution <= 0) return [];

  const coverage = new Map<number, number>();
  const cover = (bin: number, value: BitValue) =>
    coverage.set(bin, (coverage.get(bin) ?? 0) | (value ? 2 : 1));

  for (const run of runs) {
    const first = Math.floor((run.start - start) / resolution);
    const last = Math.max(
      first,
      Math.ceil((run.end - start) / resolution) - 1,
    );
    cover(first, run.value);
    if (last !== first) cover(last, run.value);
  }

  const mixedBins = [...coverage]
    .filter(([, mask]) => mask === 3)
    .map(([bin]) => bin)
    .sort((a, b) => a - b);
  const ranges: TickRange[] = [];
  for (const bin of mixedBins) {
    const binStart = start + bin * resolution;
    const binEnd = Math.min(end, binStart + resolution);
    const previous = ranges.at(-1);
    if (previous && Math.abs(previous.end - binStart) < 1e-7) {
      previous.end = binEnd;
    } else {
      ranges.push({ start: binStart, end: binEnd });
    }
  }
  return ranges;
}

function removeRanges(runs: BitRun[], removed: TickRange[]): BitRun[] {
  if (!removed.length) return runs;

  const remaining: BitRun[] = [];
  let removedIndex = 0;
  for (const run of runs) {
    let cursor = run.start;
    while (
      removedIndex < removed.length &&
      removed[removedIndex].end <= cursor
    )
      removedIndex++;

    let index = removedIndex;
    while (index < removed.length && removed[index].start < run.end) {
      const range = removed[index];
      if (cursor < range.start)
        remaining.push({
          start: cursor,
          end: Math.min(run.end, range.start),
          value: run.value,
        });
      cursor = Math.max(cursor, range.end);
      if (cursor >= run.end) break;
      index++;
    }
    if (cursor < run.end)
      remaining.push({ start: cursor, end: run.end, value: run.value });
  }
  return remaining;
}

function pathForRuns(runs: BitRun[], start: number, end: number): string {
  if (!runs.length || end <= start) return "";

  const y = (value: BitValue) => (value ? 8 : 28);
  const x = (tick: number) => ((tick - start) / (end - start)) * 1000;
  let path = "";
  let previous: BitRun | undefined;

  for (const run of runs) {
    if (!previous || Math.abs(previous.end - run.start) > 1e-7) {
      path += ` M ${x(run.start)} ${y(run.value)}`;
    } else if (previous.value !== run.value) {
      path += ` V ${y(run.value)}`;
    }
    path += ` H ${x(run.end)}`;
    previous = run;
  }

  return path.trimStart();
}

export function buildWaveformGeometry(
  runs: BitRun[],
  start: number,
  end: number,
  resolution: number,
): WaveformGeometry {
  const visibleRuns = runsInRange(runs, start, end);
  const mixed = mixedRangesFor(visibleRuns, start, end, resolution);
  return {
    path: pathForRuns(removeRanges(visibleRuns, mixed), start, end),
    mixed,
  };
}
