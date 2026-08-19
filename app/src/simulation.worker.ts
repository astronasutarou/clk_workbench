import { compile } from "./lib/clk";
import {
  aggregateSingleRowPatternRuns,
  buildInstanceRanges,
} from "./lib/output-sequence";
import {
  MAX_EXECUTION_STEPS,
  getOutputSequencePreview,
  normalizeMaximumWaveformTicks,
  type SimulationRequest,
  type SimulationResponse,
} from "./lib/simulation";
import { buildBitRuns, type BitRun } from "./lib/waveform";

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<SimulationRequest>) => void) | null;
  postMessage(message: SimulationResponse): void;
};

workerScope.onmessage = ({ data }) => {
  try {
    const execution = compile(data.source, {
      events: data.events,
      labelOffset: data.labelOffset,
      maxSteps: MAX_EXECUTION_STEPS,
      maxTicks: normalizeMaximumWaveformTicks(data.maxTicks),
    });
    const { segments, ...summary } = execution,
      aggregated = aggregateSingleRowPatternRuns(segments),
      preview = getOutputSequencePreview(aggregated);
    let mask = 0;
    for (const segment of aggregated) mask |= segment.word;
    const activeBits = Array.from({ length: 32 }, (_, bit) => 31 - bit).filter(
      (bit) => ((mask >>> bit) & 1) === 1,
    );
    if (!activeBits.length)
      activeBits.push(...Array.from({ length: 8 }, (_, bit) => 7 - bit));
    const result = {
      ...summary,
      activeBits,
      bitRuns: activeBits.map((bit): [number, BitRun[]] => [
        bit,
        buildBitRuns(aggregated, bit),
      ]),
      instanceRanges: buildInstanceRanges(segments),
      outputRows: segments.length,
      outputSequence: preview.entries,
      outputSequenceEntries: preview.total,
      outputSequenceTruncated: preview.truncated,
    };
    workerScope.postMessage({ id: data.id, result });
  } catch (error) {
    workerScope.postMessage({
      id: data.id,
      error: error instanceof Error ? error.message : "Simulation failed",
    });
  }
};
