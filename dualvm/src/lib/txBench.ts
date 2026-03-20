/* ── TX Timing Instrumentation ─────────────────────────────────── 
 *  Backward-compatible wrapper that bridges to the perf observatory.
 *  Keeps the existing benchStart/benchMark/benchEnd API intact.
 * ──────────────────────────────────────────────────────────────── */

import { perf } from "./perf";

export interface TxBenchmark {
  action: string;
  startedAt: number;
  phases: Record<string, number>;
  totalMs?: number;
}

const benchmarks: TxBenchmark[] = [];
let current: TxBenchmark | null = null;
let currentPerfId: string | null = null;

export function benchStart(action: string): void {
  current = { action, startedAt: Date.now(), phases: { click: Date.now() } };
  currentPerfId = perf.tx.start(action);
}

export function benchMark(phase: string): void {
  if (!current) return;
  current.phases[phase] = Date.now();
  if (currentPerfId) perf.tx.mark(currentPerfId, phase);
}

export function benchEnd(): TxBenchmark | null {
  if (!current) return null;
  const end = Date.now();
  current.phases.complete = end;
  current.totalMs = end - current.startedAt;
  benchmarks.push(current);
  const result = current;
  current = null;

  if (currentPerfId) {
    perf.tx.end(currentPerfId, { totalMs: result.totalMs, phases: Object.keys(result.phases) });
    currentPerfId = null;
  }

  console.group(`⏱ TX Bench: ${result.action} (${result.totalMs}ms total)`);
  let prev = result.startedAt;
  for (const [phase, ts] of Object.entries(result.phases)) {
    const delta = ts - prev;
    const fromStart = ts - result.startedAt;
    console.log(`  ${phase.padEnd(20)} +${delta}ms  (${fromStart}ms)`);
    prev = ts;
  }
  console.groupEnd();

  return result;
}

export function benchAbort(reason?: string): void {
  if (current) {
    current.phases.aborted = Date.now();
    current.totalMs = Date.now() - current.startedAt;
    if (reason) current.phases[`abort_reason:${reason}`] = Date.now();
    benchmarks.push(current);
    console.warn(`⏱ TX Bench: ${current.action} ABORTED after ${current.totalMs}ms${reason ? ` — ${reason}` : ""}`);
    if (currentPerfId) {
      perf.tx.fail(currentPerfId, reason ?? "aborted");
      currentPerfId = null;
    }
    current = null;
  }
}

export function benchLog(key: string, value: string | number | boolean): void {
  if (!current) return;
  console.log(`  ⏱ [${current.action}] ${key}: ${value}`);
}

export function getBenchmarks(): readonly TxBenchmark[] {
  return benchmarks;
}

export function getLastBenchmark(): TxBenchmark | null {
  return benchmarks.length > 0 ? benchmarks[benchmarks.length - 1] : null;
}
