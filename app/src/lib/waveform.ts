import type { Segment } from "./clk";

export type BitValue = 0 | 1;

export type BitRun = {
  start: number;
  end: number;
  value: BitValue;
};

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

export function pathForBitRuns(runs: BitRun[], total: number): string {
  if (!runs.length || total <= 0) return "";

  const y = (value: BitValue) => (value ? 8 : 28);
  let path = `M 0 ${y(runs[0].value)}`;

  for (const [index, run] of runs.entries()) {
    if (index > 0) path += ` V ${y(run.value)}`;
    path += ` H ${(run.end / total) * 1000}`;
  }

  return path;
}
