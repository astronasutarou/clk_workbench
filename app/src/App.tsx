import {
  ChangeEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { validateEventCommand, type ClockEvent } from "./lib/clk";
import { EXAMPLES } from "./example";
import { shouldActivateEventTrack } from "./lib/event-ui";
import { instanceForTick as resolveInstanceForTick } from "./lib/output-sequence";
import {
  DEFAULT_MAX_WAVEFORM_TICKS,
  MAX_WAVEFORM_TICKS,
  SIMULATION_DEBOUNCE_MS,
  normalizeMaximumWaveformTicks,
  type SimulationResponse,
  type SimulationViewResult,
} from "./lib/simulation";
import {
  buildWaveformGeometry,
  getMinimumViewSpan,
  getWaveformChunks,
  getWaveformRenderRange,
  isTimelinePointerX,
  type BitRun,
} from "./lib/waveform";

const WAVE_LABEL_WIDTH = 82;

const EMPTY_RESULT: SimulationViewResult = {
  activeBits: Array.from({ length: 8 }, (_, bit) => 7 - bit),
  bitRuns: [],
  diagnostics: [],
  halted: false,
  instanceRanges: [],
  outputRows: 0,
  outputSequence: [],
  outputSequenceEntries: 0,
  outputSequenceTruncated: false,
  program: null,
  steps: 0,
  stopReason: "program-end",
  ticks: 0,
};

type WaveformChunkProps = {
  runs: BitRun[];
  start: number;
  end: number;
  total: number;
  resolution: number;
};

const WaveformChunk = memo(function WaveformChunk({
  runs,
  start,
  end,
  total,
  resolution,
}: WaveformChunkProps) {
  const renderRange = getWaveformRenderRange(
      { start, end },
      total,
      resolution,
    ),
    renderStart = renderRange.start,
    renderEnd = renderRange.end;
  const geometry = useMemo(
    () => buildWaveformGeometry(runs, renderStart, renderEnd, resolution),
    [renderEnd, renderStart, resolution, runs],
  );
  return (
    <svg
      className="wave-chunk"
      viewBox="0 0 1000 36"
      preserveAspectRatio="none"
      style={{
        left: `${(renderStart / total) * 100}%`,
        width: `${((renderEnd - renderStart) / total) * 100}%`,
      }}
    >
      <path d={geometry.path} />
      {geometry.mixed.map((range) => (
        <rect
          key={range.start}
          className="wave-mixed"
          x={((range.start - renderStart) / (renderEnd - renderStart)) * 1000}
          y="8"
          width={
            ((range.end - range.start) / (renderEnd - renderStart)) * 1000
          }
          height="20"
        />
      ))}
    </svg>
  );
});

export default function App() {
  const [source, setSource] = useState(EXAMPLES[0].source),
    [fileName, setFileName] = useState<string>(EXAMPLES[0].name),
    [viewSpan, setViewSpan] = useState<number | null>(null),
    [viewStart, setViewStart] = useState(0),
    [labelOffset, setLabelOffset] = useState(0),
    [maxWaveformTicks, setMaxWaveformTicks] = useState(
      DEFAULT_MAX_WAVEFORM_TICKS,
    ),
    [tab, setTab] = useState<"wave" | "segments">("wave"),
    [sourceScroll, setSourceScroll] = useState(0),
    [waveTrackWidth, setWaveTrackWidth] = useState(1000),
    [selection, setSelection] = useState<{
      start: number;
      current: number;
      scrollLeft: number;
      scrollTop: number;
      viewportHeight: number;
    } | null>(null),
    [events, setEvents] = useState<ClockEvent[]>([]),
    [eventDraft, setEventDraft] = useState<
      (ClockEvent & { error: string; originalTick: number | null }) | null
    >(null),
    [result, setResult] = useState<SimulationViewResult>(EMPTY_RESULT),
    [simulating, setSimulating] = useState(true);
  const input = useRef<HTMLInputElement>(null),
    exampleMenu = useRef<HTMLDetailsElement>(null),
    waveScroll = useRef<HTMLDivElement>(null),
    pendingStart = useRef<number | null>(null),
    simulationRequest = useRef(0);
  useEffect(() => {
    const id = ++simulationRequest.current;
    let worker: Worker | null = null;
    setSimulating(true);
    const timer = window.setTimeout(() => {
      worker = new Worker(new URL("./simulation.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = ({ data }: MessageEvent<SimulationResponse>) => {
        if (data.id !== simulationRequest.current) return;
        if ("error" in data) {
          setResult({
            ...EMPTY_RESULT,
            diagnostics: [{ line: 1, severity: "error", message: data.error }],
            stopReason: "error",
          });
        } else setResult(data.result);
        setSimulating(false);
        worker?.terminate();
        worker = null;
      };
      worker.onerror = () => {
        if (id !== simulationRequest.current) return;
        setResult({
          ...EMPTY_RESULT,
          diagnostics: [
            {
              line: 1,
              severity: "error",
              message: "Simulation worker failed",
            },
          ],
          stopReason: "error",
        });
        setSimulating(false);
        worker?.terminate();
        worker = null;
      };
      worker.postMessage({
        id,
        events,
        labelOffset,
        maxTicks: maxWaveformTicks,
        source,
      });
    }, SIMULATION_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      worker?.terminate();
    };
  }, [events, labelOffset, maxWaveformTicks, source]);
  const total = result.ticks,
    activeBits = result.activeBits,
    outputSequence = result.outputSequence,
    outputSequenceTruncated = result.outputSequenceTruncated,
    waveViewportWidth = waveTrackWidth + WAVE_LABEL_WIDTH,
    minSpan = getMinimumViewSpan(total, waveViewportWidth),
    effectiveSpan = total
      ? Math.min(total, Math.max(minSpan, viewSpan ?? total))
      : 0;
  const rulerStep = Math.max(1, Math.round(effectiveSpan / 10)),
    bitRuns = useMemo(() => new Map(result.bitRuns), [result.bitRuns]),
    waveformChunks = useMemo(
      () => getWaveformChunks(total, viewStart, effectiveSpan),
      [effectiveSpan, total, viewStart],
    ),
    waveformResolution = effectiveSpan / waveTrackWidth,
    rulerTicks = useMemo(() => {
      if (!total || !effectiveSpan) return [];
      const end = Math.min(total, viewStart + effectiveSpan),
        first = Math.ceil((viewStart - 1e-7) / rulerStep) * rulerStep,
        ticks: number[] = [];
      for (
        let tick = first;
        tick <= end + 1e-7 && ticks.length < 16;
        tick += rulerStep
      )
        ticks.push(tick);
      return ticks;
    }, [total, effectiveSpan, viewStart, rulerStep]);
  const clearEvents = () => {
    setEvents([]);
    setEventDraft(null);
  };
  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      setSource(String(reader.result ?? ""));
      setFileName(f.name);
      clearEvents();
      fitWidth();
    };
    reader.readAsText(f, "ascii");
  };
  const loadExample = (example: (typeof EXAMPLES)[number]) => {
    setSource(example.source);
    setFileName(example.name);
    clearEvents();
    fitWidth();
    exampleMenu.current?.removeAttribute("open");
  };
  const errors = result.diagnostics.filter(
      (d) => d.severity === "error",
    ).length,
    warnings = result.diagnostics.length - errors;
  const visibleStartFor = (el: HTMLDivElement) => {
    const maxStart = Math.max(0, total - effectiveSpan);
    if (!maxStart) return 0;
    return Math.min(
      maxStart,
      Math.max(0, (el.scrollLeft * total) / el.scrollWidth),
    );
  };
  const setVisibleSpan = (next: number, start?: number) => {
    if (!total) return;
    const span = Math.min(total, Math.max(minSpan, Math.round(next)));
    const el = waveScroll.current,
      currentStart = el ? visibleStartFor(el) : 0;
    const desired =
      start ?? Math.max(0, currentStart + (effectiveSpan - span) / 2);
    pendingStart.current = Math.min(total - span, Math.max(0, desired));
    setViewSpan(span);
  };
  const fitWidth = () => {
    pendingStart.current = 0;
    setViewStart(0);
    setViewSpan(null);
    if (waveScroll.current) waveScroll.current.scrollLeft = 0;
  };
  useLayoutEffect(() => {
    if (viewSpan === null || viewSpan >= minSpan || !total) return;

    const centeredStart = viewStart + (viewSpan - minSpan) / 2;
    pendingStart.current = Math.min(
      total - minSpan,
      Math.max(0, centeredStart),
    );
    setViewSpan(minSpan);
  }, [minSpan, total, viewSpan, viewStart]);
  useLayoutEffect(() => {
    const el = waveScroll.current,
      start = pendingStart.current;
    if (!el || !total) return;
    if (effectiveSpan === total) {
      el.scrollLeft = 0;
      setViewStart(0);
      pendingStart.current = null;
      return;
    }
    if (start === null) return;
    el.scrollLeft = (start * el.scrollWidth) / total;
    setViewStart(start);
    pendingStart.current = null;
  }, [effectiveSpan, total]);
  useLayoutEffect(() => {
    if (tab !== "wave") return;
    const el = waveScroll.current;
    if (!el) return;

    const updateWidth = () =>
      setWaveTrackWidth(Math.max(1, el.clientWidth - WAVE_LABEL_WIDTH));
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, [tab]);
  const selectStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !total) return;
    const canvas = e.currentTarget,
      el = waveScroll.current;
    if (!el) return;
    const rect = el.getBoundingClientRect(),
      x = e.clientX - rect.left,
      y = e.clientY - rect.top;
    if (
      !isTimelinePointerX(x, el.clientWidth, WAVE_LABEL_WIDTH) ||
      y < 0 ||
      y >= el.clientHeight
    )
      return;
    canvas.setPointerCapture(e.pointerId);
    setSelection({
      start: x,
      current: x,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
      viewportHeight: el.clientHeight,
    });
  };
  const selectMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!selection) return;
    const el = waveScroll.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setSelection({
      ...selection,
      current: Math.max(
        WAVE_LABEL_WIDTH,
        Math.min(el.clientWidth, e.clientX - rect.left),
      ),
    });
  };
  const selectEnd = () => {
    if (!selection) return;
    const el = waveScroll.current,
      width = Math.abs(selection.current - selection.start);
    if (!el) {
      setSelection(null);
      return;
    }
    setSelection(null);
    if (width < 8) return;
    const left = Math.min(selection.start, selection.current),
      timelineWidth = Math.max(1, el.clientWidth - WAVE_LABEL_WIDTH),
      visibleStart = Math.min(
        Math.max(0, total - effectiveSpan),
        Math.max(0, (selection.scrollLeft * total) / el.scrollWidth),
      ),
      rawStart =
        visibleStart +
        ((left - WAVE_LABEL_WIDTH) / timelineWidth) * effectiveSpan,
      rawSpan = (width / timelineWidth) * effectiveSpan,
      nextSpan = Math.max(minSpan, Math.min(total, rawSpan)),
      center = rawStart + rawSpan / 2;
    setVisibleSpan(nextSpan, center - nextSpan / 2);
  };
  const instanceForTick = (tick: number) =>
    resolveInstanceForTick(result.instanceRanges, tick);
  const openEventAtTick = (requestedTick: number) => {
    if (simulating || !total || !result.instanceRanges.length) return;
    const tick = Math.min(total - 1, Math.max(0, Math.floor(requestedTick))),
      instance = instanceForTick(tick),
      existing = events.find((event) => event.instance === instance);
    setEventDraft(
      existing
        ? { ...existing, error: "", originalTick: existing.tick }
        : { tick, instance, command: "", error: "", originalTick: null },
    );
  };
  const openEvent = (e: ReactMouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    openEventAtTick(((e.clientX - rect.left) / rect.width) * total);
  };
  const openEventAtVisibleCenter = () =>
    openEventAtTick(viewStart + effectiveSpan / 2);
  const saveEvent = () => {
    if (!eventDraft) return;
    if (
      !Number.isInteger(eventDraft.tick) ||
      eventDraft.tick < 0 ||
      eventDraft.tick >= total
    ) {
      setEventDraft({
        ...eventDraft,
        error: `Tick must be an integer from 0 to ${Math.max(0, total - 1)}`,
      });
      return;
    }
    const error = validateEventCommand(eventDraft.command, result.program);
    if (error) {
      setEventDraft({ ...eventDraft, error });
      return;
    }
    const saved: { tick: number; instance: number; command: string } = {
        tick: eventDraft.tick,
        instance: instanceForTick(eventDraft.tick),
        command: eventDraft.command.trim(),
      },
      invalidationTick = Math.min(
        eventDraft.originalTick ?? saved.tick,
        saved.tick,
      );
    setEvents((current) =>
      [
        ...current.filter((event) => event.tick < invalidationTick),
        saved,
      ].sort((a, b) => a.tick - b.tick),
    );
    setEventDraft(null);
  };
  const deleteEvent = () => {
    if (!eventDraft) return;
    const invalidationTick = eventDraft.originalTick ?? eventDraft.tick;
    setEvents((current) =>
      current.filter((event) => event.tick < invalidationTick),
    );
    setEventDraft(null);
  };
  const eventDraftPosition =
      eventDraft && total
        ? Math.min(1, Math.max(0, eventDraft.tick / total))
        : 0,
    eventTickInvalid = eventDraft?.error.startsWith("Tick must") ?? false;
  return (
    <main>
      <header>
        <h1>Clock Definition Workbench</h1>
        <div className="file-state">
          <span>{fileName}</span>
          <span
            className={
              simulating
                ? "pill pending"
                : errors
                  ? "pill error"
                  : "pill valid"
            }
          >
            {simulating ? "updating" : errors ? `${errors} errors` : "valid"}
          </span>
        </div>
        <div className="actions">
          <input
            ref={input}
            type="file"
            accept=".clk,.src,.txt"
            onChange={onFile}
          />
          <button className="open-file" onClick={() => input.current?.click()}>
            Open file
          </button>
          <details className="example-menu" ref={exampleMenu}>
            <summary>Example</summary>
            <div className="example-list" role="menu">
              {EXAMPLES.map((example) => (
                <button
                  key={example.name}
                  type="button"
                  role="menuitem"
                  onClick={() => loadExample(example)}
                >
                  {example.name}
                </button>
              ))}
            </div>
          </details>
        </div>
      </header>
      <nav className="site-nav" aria-label="Primary">
        <a href={import.meta.env.BASE_URL} aria-current="page">
          Simulator
        </a>
        <a href={`${import.meta.env.BASE_URL}docs/`}>Documentation</a>
      </nav>
      <div className="toolbar">
        <div>
          <b>{result.program?.instructions.length ?? 0}</b>
          <span>instructions</span>
        </div>
        <div>
          <b>{result.program?.patterns.size ?? 0}</b>
          <span>patterns</span>
        </div>
        <div>
          <b>{result.outputRows.toLocaleString()}</b>
          <span>output rows</span>
        </div>
        <div>
          <b>{total.toLocaleString()}</b>
          <span>ticks</span>
        </div>
        <div className="toolbar-spacer" />
        <label>
          Maximum waveform length
          <input
            className="maximum-waveform-length"
            aria-label="Maximum waveform length"
            type="number"
            min="1"
            max={MAX_WAVEFORM_TICKS}
            step="10000"
            value={maxWaveformTicks}
            onChange={(e) => {
              setMaxWaveformTicks(
                normalizeMaximumWaveformTicks(Number(e.target.value)),
              );
              clearEvents();
            }}
          />
        </label>
        <label>
          Label address
          <select
            value={labelOffset}
            onChange={(e) => {
              setLabelOffset(Number(e.target.value));
              clearEvents();
            }}
          >
            <option value={0}>same-line instruction</option>
            <option value={1}>following address</option>
          </select>
        </label>
      </div>
      <section className="workbench">
        <article className="editor-panel">
          <div className="panel-title">
            <b>Source</b>
            <span>ASCII · CLK</span>
          </div>
          <div className="source-wrap">
            <div className="line-gutter" aria-hidden="true">
              <pre style={{ transform: `translateY(-${sourceScroll}px)` }}>
                {source.split(/\n/).map((_, i) => (
                  <span key={i}>{i + 1}</span>
                ))}
              </pre>
            </div>
            <textarea
              spellCheck={false}
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                clearEvents();
              }}
              onScroll={(e) => setSourceScroll(e.currentTarget.scrollTop)}
              aria-label="CLK source"
            />
          </div>
        </article>
        <article className="output-panel">
          <div className="panel-title">
            <div className="tabs">
              <button
                className={tab === "wave" ? "active" : ""}
                onClick={() => setTab("wave")}
              >
                Waveform
              </button>
              <button
                className={tab === "segments" ? "active" : ""}
                onClick={() => setTab("segments")}
              >
                Output sequence
              </button>
            </div>
            {tab === "wave" && (
              <div className="zoom">
                <button
                  aria-label="Zoom out"
                  title="Show more ticks"
                  disabled={effectiveSpan >= total}
                  onClick={() => setVisibleSpan(effectiveSpan * 1.5)}
                >
                  −
                </button>
                <span className="tick-count">
                  <output aria-label="Visible tick span">
                    {Math.round(effectiveSpan)}
                  </output>
                  <span>ticks</span>
                </span>
                <button
                  aria-label="Zoom in"
                  title="Show fewer ticks"
                  disabled={effectiveSpan <= minSpan}
                  onClick={() => setVisibleSpan(effectiveSpan / 1.5)}
                >
                  ＋
                </button>
                <button
                  className="fit-width"
                  aria-label="Fit width"
                  title="Full width (100%)"
                  disabled={!total}
                  onClick={fitWidth}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 5v14M20 5v14M8 12h8M10 9l-3 3 3 3M14 9l3 3-3 3" />
                  </svg>
                </button>
              </div>
            )}
          </div>
          {tab === "wave" ? (
            <div
              ref={waveScroll}
              className={selection ? "wave-scroll selecting" : "wave-scroll"}
              onScroll={(e) => {
                const el = e.currentTarget;
                setViewStart(total ? visibleStartFor(el) : 0);
                setSelection((current) =>
                  current
                    ? {
                        ...current,
                        scrollTop: el.scrollTop,
                        viewportHeight: el.clientHeight,
                      }
                    : current,
                );
              }}
            >
              <div
                className="wave-canvas"
                style={{
                  width: effectiveSpan
                    ? `${(total / effectiveSpan) * 100}%`
                    : "100%",
                }}
                onPointerDown={selectStart}
                onPointerMove={selectMove}
                onPointerUp={selectEnd}
                onPointerCancel={() => setSelection(null)}
              >
                <div
                  className="event-line"
                  title="Click the event row to add an event"
                >
                  <button
                    type="button"
                    className="event-label"
                    title="Add an event at tick 0"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => openEventAtTick(0)}
                  >
                    EVENT
                  </button>
                  <div
                    className="event-track"
                    role="button"
                    tabIndex={0}
                    aria-label="Add an event to the waveform"
                    title="Click to add an event"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={openEvent}
                    onKeyDown={(e) => {
                      if (
                        shouldActivateEventTrack(
                          e.key,
                          e.target === e.currentTarget,
                        )
                      ) {
                        e.preventDefault();
                        openEventAtVisibleCenter();
                      }
                    }}
                  >
                    <div className="event-pins">
                      {events.map((event) => (
                        <button
                          key={event.instance}
                          className="event-pin"
                          style={{ left: `${(event.tick / total) * 100}%` }}
                          aria-label={`Edit event at tick ${event.tick}`}
                          title={event.command}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            setEventDraft({
                              ...event,
                              error: "",
                              originalTick: event.tick,
                            });
                          }}
                        />
                      ))}
                    </div>
                    {eventDraft && (
                      <form
                        className={`event-editor ${eventDraftPosition < 0.25 ? "align-left" : eventDraftPosition > 0.75 ? "align-right" : ""}`}
                        style={{ left: `${eventDraftPosition * 100}%` }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        onSubmit={(e) => {
                          e.preventDefault();
                          saveEvent();
                        }}
                      >
                        <label>
                          <span>Event at tick</span>
                          <input
                            className={`event-tick-input ${eventTickInvalid ? "invalid" : ""}`}
                            type="number"
                            min="0"
                            max={Math.max(0, total - 1)}
                            step="1"
                            aria-label="Event tick"
                            value={eventDraft.tick}
                            onChange={(e) => {
                              const tick = Number(e.target.value);
                              setEventDraft({
                                ...eventDraft,
                                tick,
                                instance:
                                  Number.isInteger(tick) && total
                                    ? instanceForTick(
                                        Math.min(total - 1, Math.max(0, tick)),
                                      )
                                    : eventDraft.instance,
                                error: "",
                              });
                            }}
                          />
                          <small>after outp #{eventDraft.instance + 1}</small>
                        </label>
                        <input
                          autoFocus
                          className={
                            eventDraft.error && !eventTickInvalid
                              ? "invalid"
                              : undefined
                          }
                          aria-invalid={
                            Boolean(eventDraft.error) && !eventTickInvalid
                          }
                          aria-label="Event command"
                          value={eventDraft.command}
                          placeholder="load $COUNTER 0x10"
                          onChange={(e) =>
                            setEventDraft({
                              ...eventDraft,
                              command: e.target.value,
                              error: "",
                            })
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Escape") setEventDraft(null);
                          }}
                        />
                        {eventDraft.error && <p>{eventDraft.error}</p>}
                        <div>
                          {eventDraft.originalTick !== null && (
                            <button
                              type="button"
                              className="delete"
                              onClick={deleteEvent}
                            >
                              Delete
                            </button>
                          )}
                          <span />
                          <button
                            type="button"
                            onClick={() => setEventDraft(null)}
                          >
                            Cancel
                          </button>
                          <button type="submit" className="save">
                            Save
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                </div>
                <div
                  className="ruler"
                  style={{
                    width: total
                      ? `${(effectiveSpan / total) * 100}%`
                      : "100%",
                  }}
                >
                  <div className="ruler-track">
                    {rulerTicks.map((tick) => (
                      <span
                        key={tick}
                        className={
                          (tick - viewStart) / effectiveSpan < 0.001
                            ? "edge-start"
                            : tick === total ||
                                (tick - viewStart) / effectiveSpan > 0.999
                              ? "edge-end"
                              : undefined
                        }
                        style={{
                          left: `${((tick - viewStart) / effectiveSpan) * 100}%`,
                        }}
                      >
                        {tick}
                      </span>
                    ))}
                  </div>
                </div>
                {total > 0 ? (
                  activeBits.map((bit) => (
                    <div className="wave-row" key={bit}>
                      <b>BIT {String(bit).padStart(2, "0")}</b>
                      <div className="wave-track">
                        {waveformChunks.map((chunk) => (
                          <WaveformChunk
                            key={chunk.index}
                            runs={bitRuns.get(bit) ?? []}
                            start={chunk.start}
                            end={chunk.end}
                            total={total}
                            resolution={waveformResolution}
                          />
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="empty">No output sequence</div>
                )}
              </div>
              {selection && (
                <div
                  className="zoom-selection"
                  style={{
                    left:
                      selection.scrollLeft +
                      Math.min(selection.start, selection.current),
                    top: selection.scrollTop,
                    width: Math.abs(selection.current - selection.start),
                    height: selection.viewportHeight,
                  }}
                />
              )}
            </div>
          ) : (
            <div
              className={`sequence ${outputSequenceTruncated ? "truncated" : ""}`}
            >
              {outputSequenceTruncated && (
                <p className="sequence-truncation">
                  Showing first {outputSequence.length.toLocaleString()} of{" "}
                  {result.outputSequenceEntries.toLocaleString()} entries —
                  truncated
                </p>
              )}
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Pattern</th>
                    <th>Duration</th>
                    <th>BIT_WORD</th>
                  </tr>
                </thead>
                <tbody>
                  {outputSequence.map((s, i) => (
                    <tr key={i}>
                      <td>{i}</td>
                      <td>
                        {s.first ? (
                          <>
                            {s.pattern}
                            {s.count > 1 && (
                              <span className="multiple"> (× {s.count})</span>
                            )}
                          </>
                        ) : (
                          ""
                        )}
                      </td>
                      <td>{s.duration}</td>
                      <td>{s.word.toString(2).padStart(32, "0")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!outputSequence.length && (
                <div className="empty">No output sequence</div>
              )}
            </div>
          )}
        </article>
      </section>
      <section className="diagnostics">
        <div className="diag-head">
          <b>Diagnostics</b>
          <span>
            {errors} errors · {warnings} warnings ·{" "}
            {result.steps.toLocaleString()} steps{" "}
            {simulating ? "· updating" : ""} {result.halted ? "· halted" : ""}
          </span>
        </div>
        {result.diagnostics.length ? (
          <ul>
            {result.diagnostics.map((d, i) => (
              <li className={d.severity} key={i}>
                <span>{d.severity}</span>
                <code>L{d.line}</code>
                {d.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="no-issues">No issues</p>
        )}
      </section>
    </main>
  );
}
