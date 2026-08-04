import { getDb, uexPollRuns } from "@kcx/db";
import { UEX_DEFAULT_BASE, slugify, uexEnvelope } from "@kcx/shared";

const BASE = () => process.env.UEX_API_BASE ?? UEX_DEFAULT_BASE;
const TOKEN = () => process.env.UEX_API_TOKEN;

/**
 * Fetch a UEX endpoint and return the envelope's `data` verbatim (object or array).
 *
 * `allowEmpty` distinguishes the two things a null `data` can mean. On a commodities or
 * terminals pull it means the feed is broken and must be loud. On a per-category item walk
 * it means the category is genuinely empty — ten of UEX's ~66 item categories are — and
 * reporting those as failures every night would train everyone to ignore the one that
 * eventually matters.
 */
export async function fetchUexData(endpoint: string, opts: { allowEmpty?: boolean } = {}): Promise<unknown> {
  const token = TOKEN();
  const res = await fetch(`${BASE()}${endpoint}`, {
    headers: {
      "User-Agent": "KCX/0.1 (Kestrel Commodities Exchange, unofficial Star Citizen fan project)",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    // A hung upstream must not stall the worker until undici's ~5-minute defaults.
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`UEX ${endpoint} → HTTP ${res.status}`);
  const body = (await res.json()) as { status?: string; data?: unknown };
  if (body.data == null) {
    if (opts.allowEmpty) return [];
    throw new Error(`UEX ${endpoint} → empty data (status=${body.status})`);
  }
  return body.data;
}

export async function fetchUexRows(endpoint: string, opts: { allowEmpty?: boolean } = {}): Promise<unknown[]> {
  const data = await fetchUexData(endpoint, opts);
  if (!Array.isArray(data)) throw new Error(`UEX ${endpoint} → expected array data`);
  return data;
}

/** Structural stand-in for a zod schema — keeps generic inference simple across zod versions. */
export type RowParser<T> = {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: unknown };
};

/** Parse rows tolerantly: bad rows are counted and skipped, never fatal. */
export function parseRows<T>(rows: unknown[], schema: RowParser<T>, label: string): T[] {
  const ok: T[] = [];
  let bad = 0;
  for (const row of rows) {
    const parsed = schema.safeParse(row);
    if (parsed.success) ok.push(parsed.data);
    else bad++;
  }
  if (bad > 0) console.warn(`  ! ${label}: skipped ${bad}/${rows.length} unparseable rows`);
  return ok;
}

export type SlugRegistry = Set<string>;

export function claimSlug(registry: SlugRegistry, base: string, fallbackSuffix: string | number): string {
  const root = slugify(base) || `x-${fallbackSuffix}`;
  let candidate = registry.has(root) ? `${root}-${fallbackSuffix}` : root;
  // The suffixed form can itself collide (e.g. "Admin Office" id=123 vs "Admin Office 123").
  for (let n = 2; registry.has(candidate); n++) candidate = `${root}-${fallbackSuffix}-${n}`;
  registry.add(candidate);
  return candidate;
}

export async function audit(
  endpoint: string,
  startedAt: Date,
  fetched: number,
  upserted: number,
  status: "ok" | "partial" | "error",
  error?: string,
): Promise<void> {
  // Best-effort: bookkeeping failure must never fail (and so retry) already-committed work.
  try {
    await getDb()
      .insert(uexPollRuns)
      .values({
        endpoint,
        startedAt,
        finishedAt: new Date(),
        rowsFetched: fetched,
        rowsUpserted: upserted,
        status,
        error,
      });
  } catch (err) {
    console.error(`[audit] failed to record ${endpoint} ${status}:`, err instanceof Error ? err.message : err);
  }
}

export const num = (v: number | null | undefined): string | null => (v != null ? String(v) : null);
export const int = (v: number | null | undefined): number | null => (v != null ? Math.trunc(v) : null);
