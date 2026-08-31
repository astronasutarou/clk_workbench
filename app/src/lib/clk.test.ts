import assert from "node:assert/strict";
import test from "node:test";
import { MAX_REGISTER_ADDRESS, compile, validateEventCommand } from "./clk.ts";

const programWith = (definitions: string, instructions: string) => `
${definitions}
${instructions}

START_BIT_DATA
`;

test("register boundary symbols are accepted", () => {
  assert.equal(MAX_REGISTER_ADDRESS, 0xffff);

  for (const address of ["0x0000", "0x0FFF", "0x1000", "0xFFFF"]) {
    const result = compile(
      programWith(
        `$REGISTER ${address}\n$VALUE 1`,
        "load $REGISTER $VALUE\nhalt",
      ),
    );

    assert.deepEqual(
      result.diagnostics.filter(({ severity }) => severity === "error"),
      [],
      address,
    );
    assert.equal(result.halted, true, address);
  }
});

test("0xFFFF is accepted in every register operand position", () => {
  const result = compile(
    programWith(
      "$ZERO 0\n$MAX 0xFFFF\n$VALUE 1",
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

  assert.deepEqual(
    result.diagnostics.filter(({ severity }) => severity === "error"),
    [],
  );
  assert.equal(result.halted, true);
});

test("register values above 0xFFFF are rejected", () => {
  const result = compile(
    programWith(
      "$VALID 0\n$REGISTER 0x10000\n$VALUE 1",
      [
        "ajmp $REGISTER @END",
        "bjmp $REGISTER @END",
        "cjmp $REGISTER @END",
        "cmpz $REGISTER $VALID",
        "load $REGISTER $VALUE",
        "copy $REGISTER $VALID",
        "subj $REGISTER @END",
        "retn $REGISTER",
        "@END halt",
      ].join("\n"),
    ),
  );

  const rangeErrors = result.diagnostics.filter(({ message }) =>
    message.includes("outside the register range"),
  );
  assert.equal(rangeErrors.length, 8);
  assert.ok(
    rangeErrors.every(
      ({ message }) =>
        message === "$REGISTER is outside the register range 0x0000–0xFFFF",
    ),
  );
});

test("negative and malformed register definitions are rejected", () => {
  for (const value of ["-1", "0xZZZZ"]) {
    const result = compile(
      programWith(
        `$REGISTER ${value}\n$VALUE 1`,
        "load $REGISTER $VALUE\nhalt",
      ),
    );

    assert.ok(
      result.diagnostics.some(({ severity }) => severity === "error"),
      value,
    );
  }
});

test("event validation uses the expanded register range", () => {
  const result = compile(
    programWith("$ZERO 0\n$MAX 0xFFFF\n$OVER 0x10000\n$VALUE 1", "@END halt"),
  );

  assert.ok(result.program);
  for (const command of [
    "ajmp $MAX @END",
    "bjmp $MAX @END",
    "cjmp $MAX @END",
    "cmpz $MAX $ZERO",
    "load $MAX $VALUE",
    "copy $MAX $ZERO",
    "subj $MAX @END",
    "retn $MAX",
  ]) {
    assert.equal(validateEventCommand(command, result.program), null, command);
  }
  assert.match(
    validateEventCommand("load $OVER $VALUE", result.program) ?? "",
    /outside the register range 0x0000–0xFFFF/,
  );
});
