import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_NUMERIC_VALUE,
  compile,
  validateEventCommand,
  type Result,
} from "./clk.ts";

const programWith = (definitions: string, instructions: string) => `
${definitions}
${instructions}

START_BIT_DATA
`;

const programWithPattern = (definitions: string, instructions: string) => `
${definitions}
${instructions}

START_BIT_DATA
&PATTERN bit 1 00000000000000000000000000000001
         endb
`;

const errors = (result: Result) =>
  result.diagnostics.filter(({ severity }) => severity === "error");

test("numeric definitions use the unsigned 32-bit range", () => {
  assert.equal(MAX_NUMERIC_VALUE, 0xffffffff);

  for (const value of ["0", "0xFFFF", "0x10000", "0xFFFFFFFF", "4294967295"]) {
    const result = compile(programWith(`$NUMBER ${value}`, "halt"));
    assert.deepEqual(errors(result), [], value);
    assert.equal(result.halted, true, value);
  }

  for (const value of ["-1", "0xZZZZ", "0x100000000", "4294967296"]) {
    const result = compile(programWith(`$NUMBER ${value}`, "halt"));
    assert.ok(
      errors(result).some(
        ({ message }) =>
          message === "Value must be an unsigned 32-bit integer",
      ),
      value,
    );
  }
});

test("load and copy accept literal, symbol, and mixed operands", () => {
  const result = compile(
    programWith(
      "$ADDRESS 1\n$SOURCE 2\n$VALUE 3",
      [
        "load $ADDRESS $VALUE",
        "load 4 $VALUE",
        "load $ADDRESS 5",
        "load 6 7",
        "copy $ADDRESS $SOURCE",
        "copy 8 $SOURCE",
        "copy $ADDRESS 9",
        "copy 10 11",
        "load 0xFFFFFFFF 0xFFFFFFFF",
        "copy 0xFFFFFFFF 0xFFFFFFFF",
        "halt",
      ].join("\n"),
    ),
  );

  assert.deepEqual(errors(result), []);
  assert.equal(result.halted, true);
});

test("literal copy operands are interpreted as register addresses", () => {
  const result = compile(
    programWithPattern(
      "$SOURCE 0xFFFFFFFE\n$DESTINATION 0xFFFFFFFF",
      [
        "load 0xFFFFFFFE 1",
        "copy 0xFFFFFFFF 0xFFFFFFFE",
        "ajmp $DESTINATION @OUTPUT",
        "halt",
        "@OUTPUT outp &PATTERN",
        "halt",
      ].join("\n"),
    ),
  );

  assert.deepEqual(errors(result), []);
  assert.equal(result.halted, true);
  assert.equal(result.segments.length, 1);
});

test("0xFFFFFFFF is accepted in every symbol-based register position", () => {
  const result = compile(
    programWith(
      "$ZERO 0\n$MAX 0xFFFFFFFF\n$VALUE 1",
      [
        "ajmp $MAX @END",
        "bjmp $MAX @END",
        "cjmp $MAX @END",
        "cmpz $MAX $ZERO",
        "load $MAX $VALUE",
        "copy $MAX $ZERO",
        "subj $MAX @SUBROUTINE",
        "@END halt",
        "@SUBROUTINE retn $MAX",
      ].join("\n"),
    ),
  );

  assert.deepEqual(errors(result), []);
  assert.equal(result.halted, true);
});

test("load and copy reject invalid literal operands by semantic role", () => {
  for (const [instruction, expected] of [
    ["load 0x100000000 0", "Register address"],
    ["load 0 0x100000000", "Register value"],
    ["copy 0x100000000 0", "Register address"],
    ["copy 0 0x100000000", "Register address"],
    ["load -1 0", "Register address"],
    ["load 0 0xZZZZ", "Register value"],
  ] as const) {
    const result = compile(programWith("", `${instruction}\nhalt`));
    assert.ok(
      errors(result).some(({ message }) => message.startsWith(expected)),
      instruction,
    );
  }
});

test("other register operands continue to require numeric symbols", () => {
  const result = compile(programWith("", "ajmp 1 @END\n@END halt"));

  assert.ok(
    errors(result).some(
      ({ message }) => message === "Undefined numeric symbol: 1",
    ),
  );
});

test("undefined numeric symbols are rejected in literal-capable operands", () => {
  for (const instruction of [
    "load $MISSING 0",
    "load 0 $MISSING",
    "copy $MISSING 0",
    "copy 0 $MISSING",
  ]) {
    const result = compile(programWith("", `${instruction}\nhalt`));
    assert.ok(
      errors(result).some(
        ({ message }) => message === "Undefined numeric symbol: $MISSING",
      ),
      instruction,
    );
  }
});

test("event validation matches Source load and copy operand rules", () => {
  const result = compile(
    programWith("$ADDRESS 1\n$SOURCE 2\n$VALUE 3", "@END halt"),
  );

  assert.ok(result.program);
  for (const command of [
    "load $ADDRESS $VALUE",
    "load 4 $VALUE",
    "load $ADDRESS 5",
    "load 6 7",
    "copy $ADDRESS $SOURCE",
    "copy 8 $SOURCE",
    "copy $ADDRESS 9",
    "copy 10 11",
    "load 0xFFFFFFFF 0xFFFFFFFF",
    "copy 0xFFFFFFFF 0xFFFFFFFF",
  ]) {
    assert.equal(validateEventCommand(command, result.program), null, command);
  }

  for (const [command, expected] of [
    ["load 0x100000000 0", "Register address"],
    ["load 0 0x100000000", "Register value"],
    ["copy 0 0x100000000", "Register address"],
  ] as const) {
    assert.match(
      validateEventCommand(command, result.program) ?? "",
      new RegExp(`^${expected}`),
      command,
    );
  }
  assert.equal(
    validateEventCommand("copy 0 $MISSING", result.program),
    "Undefined numeric symbol: $MISSING",
  );
});

test("an Event copy with literal addresses affects later execution", () => {
  const source = programWithPattern(
    "$SOURCE 0xFFFFFFFE\n$DESTINATION 0xFFFFFFFF",
    [
      "load $SOURCE 1",
      "outp &PATTERN",
      "ajmp $DESTINATION @OUTPUT",
      "halt",
      "@OUTPUT outp &PATTERN",
      "halt",
    ].join("\n"),
  );
  const result = compile(source, {
    events: [
      {
        tick: 0,
        instance: 0,
        command: "copy 0xFFFFFFFF 0xFFFFFFFE",
      },
    ],
  });

  assert.deepEqual(errors(result), []);
  assert.equal(result.halted, true);
  assert.equal(result.segments.length, 2);
});
