import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "./clk.ts";
import {
  DEFAULT_MAX_WAVEFORM_TICKS,
  MAX_WAVEFORM_TICKS,
  getOutputSequencePreview,
  normalizeMaximumWaveformTicks,
} from "./simulation.ts";

const singleRowProgram = (duration: number, instructions: string) => `
${instructions}

START_BIT_DATA
&PATTERN bit ${duration} 00000000000000000000000000000001
         endb
`;

test("waveform length clips the final output row", () => {
  const result = compile(singleRowProgram(8, "outp &PATTERN\nhalt"), {
    maxSteps: 100,
    maxTicks: 5,
  });

  assert.equal(result.segments.length, 1);
  assert.equal(result.segments[0].duration, 5);
  assert.equal(result.ticks, 5);
  assert.equal(result.halted, false);
  assert.equal(result.stopReason, "waveform-limit");
  assert.match(result.diagnostics.at(-1)?.message ?? "", /5 ticks/);
});

test("an event does not run after a partially emitted outp", () => {
  const result = compile(
    singleRowProgram(8, "@LOOP outp &PATTERN\njump @LOOP"),
    {
      events: [{ tick: 0, instance: 0, command: "halt" }],
      maxSteps: 100,
      maxTicks: 5,
    },
  );

  assert.equal(result.halted, false);
  assert.equal(result.stopReason, "waveform-limit");
});

test("an output-free loop stops at the internal step limit", () => {
  const result = compile(singleRowProgram(1, "@LOOP jump @LOOP"), {
    maxSteps: 25,
    maxTicks: 100,
  });

  assert.equal(result.steps, 25);
  assert.equal(result.ticks, 0);
  assert.equal(result.stopReason, "step-limit");
  assert.match(
    result.diagnostics.at(-1)?.message ?? "",
    /Internal execution step limit/,
  );
});

test("simulation can generate more than fifty thousand output rows", () => {
  const source = singleRowProgram(
    1,
    "$COUNT 50000\n$COUNTER 0x20\nload $COUNTER $COUNT\n@LOOP outp &PATTERN\ncjmp $COUNTER @LOOP\nhalt",
  );
  const result = compile(source, { maxTicks: 50_010 });

  assert.equal(result.segments.length, 50_001);
  assert.equal(result.ticks, 50_001);
  assert.equal(result.halted, true);
});

test("maximum waveform length is normalized to the UI range", () => {
  assert.equal(
    normalizeMaximumWaveformTicks(Number.NaN),
    DEFAULT_MAX_WAVEFORM_TICKS,
  );
  assert.equal(normalizeMaximumWaveformTicks(0), 1);
  assert.equal(
    normalizeMaximumWaveformTicks(MAX_WAVEFORM_TICKS + 1),
    MAX_WAVEFORM_TICKS,
  );
});

test("output sequence preview reports truncated entries", () => {
  assert.deepEqual(getOutputSequencePreview([1, 2, 3], 2), {
    entries: [1, 2],
    total: 3,
    truncated: true,
  });
});
