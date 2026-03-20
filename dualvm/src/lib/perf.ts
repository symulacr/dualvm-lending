/* ── Performance Observatory ─────────────────────────────────────
 *  Unified instrumentation for the entire DualVM UI.
 *  Tracks: RPC calls, contract reads, snapshot loads, UI state
 *  transitions, wallet flows, faucet, and data refresh cycles.
 *
 *  Usage:
 *    perf.rpc.start("readContract", { fn: "totalAssets" })
 *    perf.rpc.end(id, { result: "500000..." })
 *    perf.ui.transition("form", "idle", "typing")
 *    perf.snapshot.start()  →  perf.snapshot.end(snapshot)
 *
 *  Read:
 *    perf.dump()           — full log to console table
 *    perf.summary()        — aggregate stats
 *    perf.getEntries()     — raw array
 *    (window as any).__perf  — console access
 * ──────────────────────────────────────────────────────────────── */

export type PerfCategory = "rpc" | "contract_read" | "snapshot" | "observer" | "activity" | "ui" | "tx" | "faucet" | "render" | "data_refresh";

export interface PerfEntry {
  id: string;
  category: PerfCategory;
  label: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  meta: Record<string, unknown>;
  children: string[];
}

interface AggStats {
  count: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  p95Ms: number;
}

let _id = 0;
const entries: PerfEntry[] = [];
const openSpans = new Map<string, PerfEntry>();

function nextId(prefix: string): string {
  return `${prefix}_${++_id}_${Date.now()}`;
}

function start(category: PerfCategory, label: string, meta: Record<string, unknown> = {}, parentId?: string): string {
  const id = nextId(category);
  const entry: PerfEntry = { id, category, label, startedAt: performance.now(), meta, children: [] };
  entries.push(entry);
  openSpans.set(id, entry);
  if (parentId) {
    const parent = openSpans.get(parentId);
    if (parent) parent.children.push(id);
  }
  return id;
}

function end(id: string, extraMeta?: Record<string, unknown>): PerfEntry | null {
  const entry = openSpans.get(id);
  if (!entry) return null;
  entry.endedAt = performance.now();
  entry.durationMs = Math.round((entry.endedAt - entry.startedAt) * 100) / 100;
  if (extraMeta) Object.assign(entry.meta, extraMeta);
  openSpans.delete(id);

  // Console output for long operations
  const threshold = entry.category === "rpc" || entry.category === "contract_read" ? 500 : 1000;
  const icon = entry.durationMs > threshold ? "🔴" : entry.durationMs > 200 ? "🟡" : "🟢";
  console.log(`${icon} [${entry.category}] ${entry.label}: ${entry.durationMs}ms`, entry.meta);
  return entry;
}

function fail(id: string, error: unknown): void {
  const errMsg = error instanceof Error ? error.message.slice(0, 120) : String(error);
  end(id, { error: errMsg, failed: true });
}

/* ── Namespaced helpers ────────────────────────────────────────── */

const rpc = {
  start: (method: string, meta?: Record<string, unknown>) => start("rpc", method, meta),
  end: (id: string, meta?: Record<string, unknown>) => end(id, meta),
  fail: (id: string, err: unknown) => fail(id, err),
};

const contractRead = {
  start: (fn: string, contract: string, meta?: Record<string, unknown>) =>
    start("contract_read", `${contract}.${fn}`, { fn, contract, ...meta }),
  end: (id: string, meta?: Record<string, unknown>) => end(id, meta),
  fail: (id: string, err: unknown) => fail(id, err),
};

const snapshot = {
  start: (observer?: string) => start("snapshot", "loadMarketSnapshot", { observer }),
  end: (id: string, meta?: Record<string, unknown>) => end(id, meta),
  fail: (id: string, err: unknown) => fail(id, err),
};

const observer = {
  start: (address: string) => start("observer", "loadObserverSnapshot", { address }),
  end: (id: string, meta?: Record<string, unknown>) => end(id, meta),
  fail: (id: string, err: unknown) => fail(id, err),
};

const activity = {
  start: () => start("activity", "loadRecentActivity"),
  end: (id: string, meta?: Record<string, unknown>) => end(id, meta),
  fail: (id: string, err: unknown) => fail(id, err),
};

const ui = {
  transition: (component: string, from: string, to: string, meta?: Record<string, unknown>) => {
    const id = start("ui", `${component}: ${from} → ${to}`, { component, from, to, ...meta });
    end(id);
    return id;
  },
  mount: (component: string) => {
    const id = start("render", `mount:${component}`);
    return () => end(id);
  },
  stateChange: (component: string, key: string, value: unknown) => {
    const id = start("ui", `${component}.${key}`, { component, key, value });
    end(id);
  },
};

const tx = {
  start: (action: string, meta?: Record<string, unknown>) => start("tx", action, meta),
  mark: (id: string, phase: string, meta?: Record<string, unknown>) => {
    const entry = openSpans.get(id) || entries.find(e => e.id === id);
    if (entry) {
      const elapsed = Math.round(performance.now() - entry.startedAt);
      (entry.meta as Record<string, unknown>)[`phase_${phase}`] = elapsed;
      console.log(`  ⏱ [${entry.label}] ${phase}: ${elapsed}ms`);
    }
  },
  end: (id: string, meta?: Record<string, unknown>) => end(id, meta),
  fail: (id: string, err: unknown) => fail(id, err),
};

const faucetPerf = {
  start: () => start("faucet", "faucet_claim"),
  end: (id: string, meta?: Record<string, unknown>) => end(id, meta),
  fail: (id: string, err: unknown) => fail(id, err),
};

const dataRefresh = {
  start: (trigger: string) => start("data_refresh", `refresh:${trigger}`, { trigger }),
  end: (id: string, meta?: Record<string, unknown>) => end(id, meta),
};

/* ── Analytics ─────────────────────────────────────────────────── */

function getEntries(category?: PerfCategory): PerfEntry[] {
  return category ? entries.filter(e => e.category === category) : entries;
}

function computeStats(durations: number[]): AggStats {
  if (durations.length === 0) return { count: 0, totalMs: 0, avgMs: 0, minMs: 0, maxMs: 0, p95Ms: 0 };
  const sorted = [...durations].sort((a, b) => a - b);
  const total = sorted.reduce((s, d) => s + d, 0);
  return {
    count: sorted.length,
    totalMs: Math.round(total),
    avgMs: Math.round(total / sorted.length),
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1],
  };
}

function summary(): Record<PerfCategory, AggStats> {
  const categories: PerfCategory[] = ["rpc", "contract_read", "snapshot", "observer", "activity", "ui", "tx", "faucet", "render", "data_refresh"];
  const result = {} as Record<PerfCategory, AggStats>;
  for (const cat of categories) {
    const durations = entries.filter(e => e.category === cat && e.durationMs != null).map(e => e.durationMs!);
    result[cat] = computeStats(durations);
  }
  return result;
}

function dump(): void {
  console.group("📊 Performance Observatory — Full Dump");
  const cats = summary();
  console.table(cats);
  console.log(`Total entries: ${entries.length}`);

  // Slowest 10
  const slowest = [...entries].filter(e => e.durationMs != null).sort((a, b) => b.durationMs! - a.durationMs!).slice(0, 10);
  console.group("🐌 Slowest 10:");
  for (const e of slowest) {
    console.log(`  ${e.durationMs}ms — [${e.category}] ${e.label}`, e.meta);
  }
  console.groupEnd();

  // RPC call frequency
  const rpcCounts = new Map<string, number>();
  for (const e of entries.filter(e => e.category === "rpc" || e.category === "contract_read")) {
    rpcCounts.set(e.label, (rpcCounts.get(e.label) ?? 0) + 1);
  }
  console.group("📡 RPC call frequency:");
  for (const [label, count] of [...rpcCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count}x — ${label}`);
  }
  console.groupEnd();
  console.groupEnd();
}

function clear(): void {
  entries.length = 0;
  openSpans.clear();
  _id = 0;
}

/* ── Public API ────────────────────────────────────────────────── */

export const perf = {
  rpc,
  contractRead,
  snapshot,
  observer,
  activity,
  tx,
  faucet: faucetPerf,
  dataRefresh,
  ui,
  start,
  end,
  fail,
  getEntries,
  summary,
  dump,
  clear,
};

// Expose on window for console debugging
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__perf = perf;
}
