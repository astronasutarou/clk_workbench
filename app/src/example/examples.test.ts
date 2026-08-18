import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compile } from "../lib/clk.ts";

const EXAMPLE_FILES = [
  "blink.src",
  "multibit.src",
  "event.src",
  "subroutine.src",
  "composite.src",
] as const;

for (const fileName of EXAMPLE_FILES) {
  test(`${fileName} compiles and halts`, () => {
    const source = readFileSync(new URL(fileName, import.meta.url), "utf8");
    const result = compile(source);

    assert.deepEqual(
      result.diagnostics.filter(({ severity }) => severity === "error"),
      [],
    );
    assert.equal(result.halted, true);
    assert.ok(result.segments.length > 0);
  });
}

test("event.src switches output patterns after an injected event", () => {
  const source = readFileSync(new URL("event.src", import.meta.url), "utf8");
  const result = compile(source, 0, 50_000, [
    { tick: 0, instance: 0, command: "load $MODE 1" },
  ]);

  assert.deepEqual(
    result.diagnostics.filter(({ severity }) => severity === "error"),
    [],
  );
  assert.deepEqual(
    [...new Set(result.segments.map(({ pattern }) => pattern))],
    ["&RUN", "&EVENT_MARKER"],
  );
});
