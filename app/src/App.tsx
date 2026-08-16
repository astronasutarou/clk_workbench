import {
  ChangeEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ClockEvent, compile, Segment, validateEventCommand } from "./lib/clk";
import {
  BitRun,
  buildBitRuns,
  buildWaveformGeometry,
  getVirtualScrollWidth,
  getWaveformChunks,
  getWaveformRenderRange,
  scrollLeftToViewStart,
  tickToViewportRatio,
  viewStartToScrollLeft,
} from "./lib/waveform";

const SAMPLE = `# CLK definition example
$COUNT    9
$COUNTER  0x20

load $COUNTER $COUNT
@LOOP outp &PAT_SP1
      cjmp $COUNTER @LOOP
      halt

START_BIT_DATA
&PAT_SP1 bit  18  00000000000000000000000000000000
         bit   4  00000000000000000000000000000100
         bit   4  00000000000000000000000000010100
         bit   4  00000000000000000000000000000100
         bit  18  00000000000000000000000000000000
         endb`;

const WAVE_LABEL_WIDTH = 82;

type WaveformChunkProps = {
  runs: BitRun[];
  start: number;
  end: number;
  total: number;
  resolution: number;
  viewStart: number;
  viewSpan: number;
};

const WaveformChunk = memo(function WaveformChunk({
  runs,
  start,
  end,
  total,
  resolution,
  viewStart,
  viewSpan,
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
        left: `${tickToViewportRatio(renderStart, viewStart, viewSpan) * 100}%`,
        width: `${((renderEnd - renderStart) / viewSpan) * 100}%`,
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

type AggregatedSegment = Segment & { count: number; first: boolean };
function aggregateSingleRowPatternRuns(
  segments: Segment[],
): AggregatedSegment[] {
  const invocations: { pattern: string; rows: Segment[] }[] = [];
  for (const segment of segments) {
    const last = invocations[invocations.length - 1];
    if (!last || last.rows[0].instance !== segment.instance)
      invocations.push({ pattern: segment.pattern, rows: [segment] });
    else last.rows.push(segment);
  }
  const runs: { pattern: string; rows: Segment[]; count: number }[] = [];
  for (const invocation of invocations) {
    const last = runs[runs.length - 1];
    const isSingleRow = invocation.rows.length === 1;
    if (
      isSingleRow &&
      last &&
      last.rows.length === 1 &&
      last.pattern === invocation.pattern
    )
      last.count++;
    else runs.push({ ...invocation, count: 1 });
  }
  return runs.flatMap((run) =>
    run.rows.map((row, i) => ({
      ...row,
      duration: row.duration * run.count,
      count: run.count,
      first: i === 0,
    })),
  );
}

export default function App() {
  const [source, setSource] = useState(SAMPLE),
    [fileName, setFileName] = useState("example.clk"),
    [viewSpan, setViewSpan] = useState<number | null>(null),
    [viewStart, setViewStart] = useState(0),
    [labelOffset, setLabelOffset] = useState(0),
    [stepLimit, setStepLimit] = useState(10000),
    [tab, setTab] = useState<"wave" | "segments">("wave"),
    [sourceScroll, setSourceScroll] = useState(0),
    [waveTrackWidth, setWaveTrackWidth] = useState(1000),
    [selection, setSelection] = useState<{
      start: number;
      current: number;
      viewStart: number;
      scrollTop: number;
      viewportHeight: number;
    } | null>(null),
    [events, setEvents] = useState<ClockEvent[]>([]),
    [eventDraft, setEventDraft] = useState<
      (ClockEvent & { error: string }) | null
    >(null);
  const input = useRef<HTMLInputElement>(null),
    waveScroll = useRef<HTMLDivElement>(null),
    pendingStart = useRef<number | null>(null),
    result = useMemo(
      () => compile(source, labelOffset, stepLimit, events),
      [source, labelOffset, stepLimit, events],
    );
  const displaySegments = useMemo(
    () => aggregateSingleRowPatternRuns(result.segments),
    [result.segments],
  );
  const total = displaySegments.reduce((n, s) => n + s.duration, 0),
    minSpan = Math.min(20, total),
    effectiveSpan = total
      ? Math.min(total, Math.max(minSpan, viewSpan ?? total))
      : 0,
    activeBits = useMemo(() => {
      let mask = 0;
      displaySegments.forEach((s) => (mask |= s.word));
      const bits = Array.from({ length: 32 }, (_, i) => 31 - i).filter(
        (i) => ((mask >>> i) & 1) === 1,
      );
      return bits.length ? bits : Array.from({ length: 8 }, (_, i) => 7 - i);
    }, [displaySegments]);
  const rulerStep = Math.max(1, Math.round(effectiveSpan / 10)),
    waveViewportWidth = waveTrackWidth + WAVE_LABEL_WIDTH,
    virtualScrollWidth = getVirtualScrollWidth(
      total,
      effectiveSpan,
      waveViewportWidth,
    ),
    bitRuns = useMemo(
      () =>
        new Map(
          activeBits.map((bit) => [bit, buildBitRuns(displaySegments, bit)]),
        ),
      [activeBits, displaySegments],
    ),
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
  const errors = result.diagnostics.filter(
      (d) => d.severity === "error",
    ).length,
    warnings = result.diagnostics.length - errors;
  const visibleStartFor = (el: HTMLDivElement) => {
    return scrollLeftToViewStart(
      el.scrollLeft,
      el.scrollWidth,
      el.clientWidth,
      total,
      effectiveSpan,
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
    const el = waveScroll.current,
      start = pendingStart.current;
    if (!el || !total) return;
    if (effectiveSpan === total) {
      el.scrollLeft = 0;
      setViewStart(0);
      pendingStart.current = null;
      return;
    }
    const desiredStart = Math.min(
      total - effectiveSpan,
      Math.max(0, start ?? viewStart),
    );
    el.scrollLeft = viewStartToScrollLeft(
      desiredStart,
      el.scrollWidth,
      el.clientWidth,
      total,
      effectiveSpan,
    );
    if (desiredStart !== viewStart) setViewStart(desiredStart);
    pendingStart.current = null;
  }, [effectiveSpan, total, waveTrackWidth]);
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
      x = e.clientX - rect.left - WAVE_LABEL_WIDTH,
      y = e.clientY - rect.top;
    if (x < 0 || x >= waveTrackWidth || y < 0 || y >= el.clientHeight) return;
    canvas.setPointerCapture(e.pointerId);
    setSelection({
      start: x,
      current: x,
      viewStart: visibleStartFor(el),
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
        0,
        Math.min(waveTrackWidth, e.clientX - rect.left - WAVE_LABEL_WIDTH),
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
      rawStart = selection.viewStart + (left / waveTrackWidth) * effectiveSpan,
      rawSpan = (width / waveTrackWidth) * effectiveSpan,
      nextSpan = Math.max(minSpan, Math.min(total, rawSpan)),
      center = rawStart + rawSpan / 2;
    setVisibleSpan(nextSpan, center - nextSpan / 2);
  };
  const instanceForTick = (tick: number) => {
    let cursor = 0;
    for (const segment of result.segments) {
      cursor += segment.duration;
      if (tick < cursor) return segment.instance;
    }
    return result.segments.at(-1)?.instance ?? 0;
  };
  const openEvent = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!total || !result.segments.length) return;
    const rect = e.currentTarget.getBoundingClientRect(),
      tick = Math.min(
        total - 1,
        Math.max(
          0,
          Math.floor(
            viewStart + ((e.clientX - rect.left) / rect.width) * effectiveSpan,
          ),
        ),
      ),
      instance = instanceForTick(tick),
      existing = events.find((event) => event.instance === instance);
    setEventDraft(
      existing
        ? { ...existing, error: "" }
        : { tick, instance, command: "", error: "" },
    );
  };
  const saveEvent = () => {
    if (!eventDraft) return;
    const error = validateEventCommand(eventDraft.command, result.program);
    if (error) {
      setEventDraft({ ...eventDraft, error });
      return;
    }
    const saved: { tick: number; instance: number; command: string } = {
      tick: eventDraft.tick,
      instance: eventDraft.instance,
      command: eventDraft.command.trim(),
    };
    setEvents((current) =>
      [...current.filter((event) => event.tick < saved.tick), saved].sort(
        (a, b) => a.tick - b.tick,
      ),
    );
    setEventDraft(null);
  };
  const deleteEvent = () => {
    if (!eventDraft) return;
    setEvents((current) =>
      current.filter((event) => event.tick < eventDraft.tick),
    );
    setEventDraft(null);
  };
  const viewportRatioForTick = (tick: number) =>
      tickToViewportRatio(tick, viewStart, effectiveSpan),
    eventDraftRatio = eventDraft
      ? viewportRatioForTick(eventDraft.tick)
      : null;
  return (
    <main>
      <header>
        <h1>Clock Definition Workbench</h1>
        <div className="file-state">
          <span>{fileName}</span>
          <span className={errors ? "pill error" : "pill valid"}>
            {errors ? `${errors} errors` : "valid"}
          </span>
        </div>
        <div className="actions">
          <input
            ref={input}
            type="file"
            accept=".clk,.src,.txt"
            onChange={onFile}
          />
          <button onClick={() => input.current?.click()}>Open file</button>
          <button
            onClick={() => {
              setSource(SAMPLE);
              setFileName("example.clk");
              clearEvents();
              fitWidth();
            }}
          >
            Example
          </button>
        </div>
      </header>
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
          <b>{displaySegments.length}</b>
          <span>output rows</span>
        </div>
        <div>
          <b>{total.toLocaleString()}</b>
          <span>ticks</span>
        </div>
        <div className="toolbar-spacer" />
        <label>
          Step limit
          <input
            aria-label="Step limit"
            type="number"
            min="1"
            max="1000000"
            step="1000"
            value={stepLimit}
            onChange={(e) => {
              setStepLimit(
                Math.max(1, Math.min(1000000, Number(e.target.value) || 1)),
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
                className="wave-scroll-space"
                style={{ width: virtualScrollWidth }}
              >
                <div
                  className="wave-viewport"
                  style={{ width: waveViewportWidth }}
                >
                  <div
                    className="wave-canvas"
                    onPointerDown={selectStart}
                    onPointerMove={selectMove}
                    onPointerUp={selectEnd}
                    onPointerCancel={() => setSelection(null)}
                  >
                    <div className="event-line">
                      <b>EVENT</b>
                      <div
                        className="event-track"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={openEvent}
                      >
                        <div className="event-pins">
                          {events
                            .filter(
                              (event) =>
                                viewportRatioForTick(event.tick) >= 0 &&
                                viewportRatioForTick(event.tick) <= 1,
                            )
                            .map((event) => (
                              <button
                                key={event.instance}
                                className="event-pin"
                                style={{
                                  left: `${viewportRatioForTick(event.tick) * 100}%`,
                                }}
                                aria-label={`Edit event at tick ${event.tick}`}
                                title={event.command}
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEventDraft({ ...event, error: "" });
                                }}
                              />
                            ))}
                        </div>
                        {eventDraft &&
                          eventDraftRatio !== null &&
                          eventDraftRatio >= 0 &&
                          eventDraftRatio <= 1 && (
                            <form
                              className={`event-editor ${eventDraftRatio < 0.25 ? "align-left" : eventDraftRatio > 0.75 ? "align-right" : ""}`}
                              style={{
                                left: `${eventDraftRatio * 100}%`,
                              }}
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => e.stopPropagation()}
                              onSubmit={(e) => {
                                e.preventDefault();
                                saveEvent();
                              }}
                            >
                              <label>
                                Event at tick {eventDraft.tick}
                                <small>
                                  after outp #{eventDraft.instance + 1}
                                </small>
                              </label>
                              <input
                                autoFocus
                                className={
                                  eventDraft.error ? "invalid" : undefined
                                }
                                aria-invalid={Boolean(eventDraft.error)}
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
                                {events.some(
                                  (event) =>
                                    event.instance === eventDraft.instance,
                                ) && (
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
                    <div className="ruler">
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
                              left: `${viewportRatioForTick(tick) * 100}%`,
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
                                viewStart={viewStart}
                                viewSpan={effectiveSpan}
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
                          WAVE_LABEL_WIDTH +
                          Math.min(selection.start, selection.current),
                        top: selection.scrollTop,
                        width: Math.abs(selection.current - selection.start),
                        height: selection.viewportHeight,
                      }}
                    />
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="sequence">
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
                  {displaySegments.map((s, i) => (
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
              {!displaySegments.length && (
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
            {result.halted ? "· halted" : ""}
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
