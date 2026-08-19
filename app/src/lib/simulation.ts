import type { ClockEvent, Diagnostic, Program } from "./clk";
import type { AggregatedSegment, InstanceRange } from "./output-sequence";
import type { BitRun } from "./waveform";

export const DEFAULT_MAX_WAVEFORM_TICKS = 1_000_000;
export const MAX_WAVEFORM_TICKS = 1_000_000_000;
export const MAX_EXECUTION_STEPS = 2 ** 30;
export const OUTPUT_SEQUENCE_LIMIT = 10_000;
export const SIMULATION_DEBOUNCE_MS = 250;

export function normalizeMaximumWaveformTicks(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_MAX_WAVEFORM_TICKS;
  return Math.max(1, Math.min(MAX_WAVEFORM_TICKS, Math.floor(value)));
}

export function getOutputSequencePreview<T>(
  entries: T[],
  limit = OUTPUT_SEQUENCE_LIMIT,
) {
  return {
    entries: entries.slice(0, limit),
    total: entries.length,
    truncated: entries.length > limit,
  };
}

export type SimulationRequest = {
  id: number;
  source: string;
  labelOffset: number;
  maxTicks: number;
  events: ClockEvent[];
};

export type SimulationViewResult = {
  activeBits: number[];
  bitRuns: [number, BitRun[]][];
  diagnostics: Diagnostic[];
  halted: boolean;
  instanceRanges: InstanceRange[];
  outputRows: number;
  outputSequence: AggregatedSegment[];
  outputSequenceEntries: number;
  outputSequenceTruncated: boolean;
  program: Program | null;
  steps: number;
  stopReason:
    | "error"
    | "halt"
    | "program-end"
    | "step-limit"
    | "waveform-limit";
  ticks: number;
};

export type SimulationResponse =
  | { id: number; result: SimulationViewResult }
  | { id: number; error: string };
