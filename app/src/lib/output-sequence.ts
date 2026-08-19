import type { Segment } from "./clk";

export type AggregatedSegment = Segment & { count: number; first: boolean };
export type InstanceRange = { end: number; instance: number };

export function aggregateSingleRowPatternRuns(
  segments: Segment[],
): AggregatedSegment[] {
  const output: AggregatedSegment[] = [];
  let index = 0,
    previousWasSingleRow = false;

  while (index < segments.length) {
    const start = index,
      instance = segments[index].instance;
    while (index < segments.length && segments[index].instance === instance)
      index++;
    const rowCount = index - start,
      row = segments[start],
      previous = output.at(-1);

    if (
      rowCount === 1 &&
      previousWasSingleRow &&
      previous?.pattern === row.pattern
    ) {
      previous.duration += row.duration;
      previous.count++;
    } else {
      for (let rowIndex = start; rowIndex < index; rowIndex++)
        output.push({
          ...segments[rowIndex],
          count: 1,
          first: rowIndex === start,
        });
    }
    previousWasSingleRow = rowCount === 1;
  }
  return output;
}

export function buildInstanceRanges(segments: Segment[]): InstanceRange[] {
  const ranges: InstanceRange[] = [];
  let end = 0;
  for (const segment of segments) {
    end += segment.duration;
    const previous = ranges.at(-1);
    if (previous?.instance === segment.instance) previous.end = end;
    else ranges.push({ end, instance: segment.instance });
  }
  return ranges;
}

export function instanceForTick(ranges: InstanceRange[], tick: number) {
  let low = 0,
    high = ranges.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (tick < ranges[middle].end) high = middle - 1;
    else low = middle + 1;
  }
  return ranges[Math.min(low, ranges.length - 1)]?.instance ?? 0;
}
