import {
  DEFAULT_MAX_WAVEFORM_TICKS,
  MAX_EXECUTION_STEPS,
} from "./simulation.ts";

export type Diagnostic = {
  line: number;
  severity: "error" | "warning";
  message: string;
};
export type Segment = {
  duration: number;
  word: number;
  pattern: string;
  instance: number;
};
type Instruction = { line: number; op: string; args: string[] };
type Pattern = { line: number; rows: { duration: number; word: number }[] };
export type Program = {
  definitions: Map<string, number>;
  labels: Map<string, number>;
  patterns: Map<string, Pattern>;
  instructions: Instruction[];
};
export type Result = {
  diagnostics: Diagnostic[];
  program: Program | null;
  segments: Segment[];
  steps: number;
  halted: boolean;
  ticks: number;
  stopReason:
    | "error"
    | "halt"
    | "program-end"
    | "step-limit"
    | "waveform-limit";
};
export type ClockEvent = { tick: number; instance: number; command: string };

export type CompileOptions = {
  events?: ClockEvent[];
  labelOffset?: number;
  maxSteps?: number;
  maxTicks?: number;
};

const OPS: Record<
  string,
  { n: number; k: ("value" | "register" | "label" | "pattern")[] }
> = {
  nop: { n: 0, k: [] },
  outp: { n: 1, k: ["pattern"] },
  jump: { n: 1, k: ["label"] },
  ajmp: { n: 2, k: ["register", "label"] },
  bjmp: { n: 2, k: ["register", "label"] },
  cjmp: { n: 2, k: ["register", "label"] },
  cmpz: { n: 2, k: ["register", "register"] },
  load: { n: 2, k: ["register", "value"] },
  copy: { n: 2, k: ["register", "register"] },
  subj: { n: 2, k: ["register", "label"] },
  retn: { n: 1, k: ["register"] },
  halt: { n: 0, k: [] },
};
const numberValue = (s: string) =>
  /^(?:0x[0-9a-f]+|[0-9]+)$/i.test(s) ? Number(s) : NaN;

export function compile(
  source: string,
  {
    events = [],
    labelOffset = 0,
    maxSteps = MAX_EXECUTION_STEPS,
    maxTicks = DEFAULT_MAX_WAVEFORM_TICKS,
  }: CompileOptions = {},
): Result {
  const diagnostics: Diagnostic[] = [],
    definitions = new Map<string, number>(),
    labels = new Map<string, number>(),
    patterns = new Map<string, Pattern>(),
    instructions: Instruction[] = [];
  const lines = source.split(/\r?\n/);
  let marker = -1,
    active: {
      name: string;
      line: number;
      rows: { duration: number; word: number }[];
    } | null = null;
  const issue = (
    line: number,
    message: string,
    severity: "error" | "warning" = "error",
  ) => diagnostics.push({ line, severity, message });
  lines.forEach((raw, i) => {
    if ([...raw].some((c) => c.charCodeAt(0) > 127))
      issue(i + 1, "Non-ASCII character found");
  });
  const clean = lines.map((x) => x.replace(/#.*/, "").trim());
  clean.forEach((line, i) => {
    if (line === "START_BIT_DATA") {
      if (marker >= 0) issue(i + 1, "Duplicate START_BIT_DATA marker");
      else marker = i;
    }
  });
  if (marker < 0) issue(1, "Missing START_BIT_DATA marker");
  clean.slice(0, marker < 0 ? clean.length : marker).forEach((line, i) => {
    if (!line) return;
    const t = line.split(/\s+/);
    if (t[0].startsWith("$")) {
      if (t.length !== 2) {
        issue(i + 1, "Numeric definition must have the form $NAME VALUE");
        return;
      }
      const n = numberValue(t[1]);
      if (definitions.has(t[0])) issue(i + 1, `Duplicate definition: ${t[0]}`);
      else if (!Number.isInteger(n) || n < 0 || n > 0xffffffff)
        issue(i + 1, "Value must be an unsigned 32-bit integer");
      else definitions.set(t[0], n);
      return;
    }
    let label: string | undefined;
    if (t[0].startsWith("@")) {
      label = t.shift();
      if (!t.length) {
        issue(
          i + 1,
          "A command label and its instruction must be on the same line",
        );
        return;
      }
    }
    const op = t.shift()!;
    if (!OPS[op]) {
      issue(i + 1, `Unknown instruction: ${op}`);
      return;
    }
    if (label) {
      if (labels.has(label)) issue(i + 1, `Duplicate definition: ${label}`);
      else labels.set(label, instructions.length + labelOffset);
    }
    if (t.length !== OPS[op].n)
      issue(
        i + 1,
        `${op} expects ${OPS[op].n} operand${OPS[op].n === 1 ? "" : "s"}`,
      );
    instructions.push({ line: i + 1, op, args: t });
  });
  if (marker >= 0)
    clean.slice(marker + 1).forEach((line, j) => {
      const lineNo = marker + j + 2;
      if (!line) return;
      const t = line.split(/\s+/);
      if (t[0].startsWith("&")) {
        if (active) {
          issue(lineNo, `Pattern ${active.name} is not terminated by endb`);
          patterns.set(active.name, { line: active.line, rows: active.rows });
        }
        const name = t.shift()!;
        if (patterns.has(name)) issue(lineNo, `Duplicate definition: ${name}`);
        active = { name, line: lineNo, rows: [] };
        if (t.shift() !== "bit") {
          issue(
            lineNo,
            "First pattern row must have the form &NAME bit DURATION BIT_WORD",
          );
          return;
        }
        addRow(active, t, lineNo, issue);
        return;
      }
      if (t[0] === "bit") {
        if (!active) {
          issue(lineNo, "Bit row appears outside a pattern");
          return;
        }
        t.shift();
        addRow(active, t, lineNo, issue);
        return;
      }
      if (t[0] === "endb") {
        if (t.length !== 1) issue(lineNo, "endb takes no operands");
        if (!active) {
          issue(lineNo, "endb has no matching pattern");
          return;
        }
        if (!active.rows.length) issue(lineNo, "Empty pattern is not allowed");
        patterns.set(active.name, { line: active.line, rows: active.rows });
        active = null;
        return;
      }
      issue(lineNo, "Expected a bit row or endb");
    });
  const unfinished = active as {
    name: string;
    line: number;
    rows: { duration: number; word: number }[];
  } | null;
  if (unfinished) {
    issue(
      lines.length,
      `Pattern ${unfinished.name} is not terminated by endb`,
    );
    patterns.set(unfinished.name, {
      line: unfinished.line,
      rows: unfinished.rows,
    });
  }
  instructions.forEach((ins) => {
    const spec = OPS[ins.op];
    ins.args.forEach((arg, x) => {
      const kind = spec.k[x];
      if (kind === "label" && !labels.has(arg))
        issue(ins.line, `Undefined command label: ${arg}`);
      if (kind === "pattern" && !patterns.has(arg))
        issue(ins.line, `Undefined pattern: ${arg}`);
      if ((kind === "value" || kind === "register") && !definitions.has(arg))
        issue(ins.line, `Undefined numeric symbol: ${arg}`);
      if (
        kind === "register" &&
        definitions.has(arg) &&
        (definitions.get(arg) ?? 0) > 0xfff
      )
        issue(ins.line, `${arg} is outside the register range 0x0000–0x0FFF`);
    });
  });
  if (diagnostics.some((d) => d.severity === "error"))
    return {
      diagnostics,
      program: null,
      segments: [],
      steps: 0,
      halted: false,
      ticks: 0,
      stopReason: "error",
    };
  const program = { definitions, labels, patterns, instructions },
    eventInstructions = new Map<number, Instruction>();
  events.forEach((event) => {
    const parsed = parseEventCommand(event.command, program);
    if (typeof parsed === "string")
      issue(1, `Event at tick ${event.tick}: ${parsed}`);
    else eventInstructions.set(event.instance, parsed);
  });
  if (diagnostics.some((d) => d.severity === "error"))
    return {
      diagnostics,
      program,
      segments: [],
      steps: 0,
      halted: false,
      ticks: 0,
      stopReason: "error",
    };
  return execute(
    program,
    diagnostics,
    Math.max(1, Math.floor(maxSteps)),
    Math.max(1, Math.floor(maxTicks)),
    eventInstructions,
  );
}

function parseEventCommand(
  command: string,
  program: Program,
): Instruction | string {
  if (/\r|\n/.test(command)) return "Enter exactly one instruction";
  const clean = command.replace(/#.*/, "").trim();
  if (!clean) return "Command is required";
  const t = clean.split(/\s+/),
    op = t.shift()!;
  if (op.startsWith("@")) return "Event commands cannot define labels";
  const spec = OPS[op];
  if (!spec) return `Unknown instruction: ${op}`;
  if (op === "outp") return "outp is not allowed in an event";
  if (t.length !== spec.n)
    return `${op} expects ${spec.n} operand${spec.n === 1 ? "" : "s"}`;
  for (let i = 0; i < t.length; i++) {
    const arg = t[i],
      kind = spec.k[i];
    if (kind === "label" && !program.labels.has(arg))
      return `Undefined command label: ${arg}`;
    if (kind === "register" && !program.definitions.has(arg))
      return `Undefined numeric symbol: ${arg}`;
    if (kind === "register" && (program.definitions.get(arg) ?? 0) > 0xfff)
      return `${arg} is outside the register range 0x0000–0x0FFF`;
    if (
      kind === "value" &&
      !program.definitions.has(arg) &&
      !Number.isInteger(numberValue(arg))
    )
      return `Undefined value: ${arg}`;
    if (
      kind === "value" &&
      Number.isInteger(numberValue(arg)) &&
      (numberValue(arg) < 0 || numberValue(arg) > 0xffffffff)
    )
      return "Value must be an unsigned 32-bit integer";
  }
  return { line: 1, op, args: t };
}

export function validateEventCommand(
  command: string,
  program: Program | null,
): string | null {
  if (!program) return "A valid CLK program is required";
  const parsed = parseEventCommand(command, program);
  return typeof parsed === "string" ? parsed : null;
}

function addRow(
  active: { rows: { duration: number; word: number }[] },
  t: string[],
  line: number,
  issue: (l: number, m: string, s?: "error" | "warning") => void,
) {
  if (t.length !== 2) {
    issue(line, "Bit row must have the form bit DURATION BIT_WORD");
    return;
  }
  const duration = numberValue(t[0]);
  if (!Number.isInteger(duration) || duration <= 0) {
    issue(line, "DURATION must be a positive integer");
    return;
  }
  if (!/^[01]{32}$/.test(t[1])) {
    issue(line, "BIT_WORD must contain exactly 32 binary digits");
    return;
  }
  active.rows.push({ duration, word: parseInt(t[1], 2) >>> 0 });
}
function execute(
  program: Program,
  diagnostics: Diagnostic[],
  maxSteps: number,
  maxTicks: number,
  eventInstructions = new Map<number, Instruction>(),
): Result {
  const r = new Map<number, number>(),
    segments: Segment[] = [];
  let p = 0,
    steps = 0,
    halted = false,
    instance = 0,
    ticks = 0,
    waveformLimitReached = false;
  const value = (s: string) => program.definitions.get(s) ?? 0;
  const eventValue = (s: string) =>
    program.definitions.get(s) ?? numberValue(s);
  const runEvent = (ins: Instruction) => {
    const a = ins.args;
    switch (ins.op) {
      case "nop":
        break;
      case "jump":
        p = program.labels.get(a[0])!;
        break;
      case "ajmp":
        p = (r.get(value(a[0])) ?? 0) > 0 ? program.labels.get(a[1])! : p;
        break;
      case "bjmp": {
        const k = value(a[0]),
          v = r.get(k) ?? 0;
        if (v > 0) {
          r.set(k, 0);
          p = program.labels.get(a[1])!;
        }
        break;
      }
      case "cjmp": {
        const k = value(a[0]),
          v = r.get(k) ?? 0;
        if (v > 0) {
          r.set(k, v - 1);
          p = program.labels.get(a[1])!;
        }
        break;
      }
      case "cmpz": {
        const x = value(a[0]),
          y = value(a[1]);
        if ((r.get(x) ?? 0) === (r.get(y) ?? 0)) r.set(x, 0);
        break;
      }
      case "load":
        r.set(value(a[0]), eventValue(a[1]));
        break;
      case "copy":
        r.set(value(a[0]), r.get(value(a[1])) ?? 0);
        break;
      case "subj":
        r.set(value(a[0]), p);
        p = program.labels.get(a[1])!;
        break;
      case "retn":
        p = r.get(value(a[0])) ?? program.instructions.length;
        break;
      case "halt":
        halted = true;
        p = program.instructions.length;
        break;
    }
  };
  while (
    p >= 0 &&
    p < program.instructions.length &&
    steps < maxSteps &&
    ticks < maxTicks
  ) {
    const ins = program.instructions[p],
      a = ins.args;
    steps++;
    switch (ins.op) {
      case "nop":
        p++;
        break;
      case "outp": {
        const pat = program.patterns.get(a[0])!,
          currentInstance = instance;
        let outputComplete = true;
        for (const row of pat.rows) {
          const remaining = maxTicks - ticks;
          if (remaining <= 0) {
            outputComplete = false;
            break;
          }
          const duration = Math.min(row.duration, remaining);
          segments.push({
            ...row,
            duration,
            pattern: a[0],
            instance: currentInstance,
          });
          ticks += duration;
          if (duration < row.duration) {
            outputComplete = false;
            break;
          }
        }
        instance++;
        p++;
        const event = outputComplete
          ? eventInstructions.get(currentInstance)
          : undefined;
        if (event && steps < maxSteps) {
          steps++;
          runEvent(event);
        }
        if (ticks >= maxTicks) waveformLimitReached = true;
        break;
      }
      case "jump":
        p = program.labels.get(a[0])!;
        break;
      case "ajmp":
        p = (r.get(value(a[0])) ?? 0) > 0 ? program.labels.get(a[1])! : p + 1;
        break;
      case "bjmp": {
        const k = value(a[0]),
          v = r.get(k) ?? 0;
        if (v > 0) {
          r.set(k, 0);
          p = program.labels.get(a[1])!;
        } else p++;
        break;
      }
      case "cjmp": {
        const k = value(a[0]),
          v = r.get(k) ?? 0;
        if (v > 0) {
          r.set(k, v - 1);
          p = program.labels.get(a[1])!;
        } else p++;
        break;
      }
      case "cmpz": {
        const x = value(a[0]),
          y = value(a[1]);
        if ((r.get(x) ?? 0) === (r.get(y) ?? 0)) r.set(x, 0);
        p++;
        break;
      }
      case "load":
        r.set(value(a[0]), value(a[1]));
        p++;
        break;
      case "copy":
        r.set(value(a[0]), r.get(value(a[1])) ?? 0);
        p++;
        break;
      case "subj":
        r.set(value(a[0]), p + 1);
        p = program.labels.get(a[1])!;
        break;
      case "retn":
        p = r.get(value(a[0])) ?? program.instructions.length;
        break;
      case "halt":
        halted = true;
        p = program.instructions.length;
        break;
      default:
        p++;
    }
  }
  const stopReason: Result["stopReason"] = halted
    ? "halt"
    : waveformLimitReached || ticks >= maxTicks
      ? "waveform-limit"
      : steps >= maxSteps
        ? "step-limit"
        : "program-end";
  if (!halted)
    diagnostics.push({
      line:
        program.instructions[Math.min(p, program.instructions.length - 1)]
          ?.line ?? 1,
      severity: "warning",
      message:
        stopReason === "waveform-limit"
          ? `Waveform truncated at ${maxTicks.toLocaleString()} ticks`
          : stopReason === "step-limit"
            ? `Internal execution step limit reached after ${maxSteps.toLocaleString()} steps`
            : "Execution ended without reaching halt",
    });
  return { diagnostics, program, segments, steps, halted, ticks, stopReason };
}
