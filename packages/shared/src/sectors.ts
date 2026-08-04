/**
 * Market sectors — the S&P-style grouping for index tickers. Every commodity maps to
 * exactly one sector via its UEX `kind`; KCXC is the all-commodity composite.
 * Indices are base-1000, equal-weight vs each commodity's first-seen baseline price.
 */

export type SectorCode = "KCXC" | "METL" | "MINR" | "GASF" | "AGRI" | "VICE" | "INDL" | "MISC";

export const COMPOSITE_SECTOR: SectorCode = "KCXC";
export const INDEX_BASE = 1000;

export const SECTORS: { code: SectorCode; name: string; kinds: string[] }[] = [
  { code: "KCXC", name: "KCX Composite", kinds: [] }, // all tradable commodities
  { code: "METL", name: "Metals", kinds: ["metal"] },
  { code: "MINR", name: "Minerals & Ores", kinds: ["mineral"] },
  { code: "GASF", name: "Gas & Fuel", kinds: ["gas", "halogen", "fuel"] },
  { code: "AGRI", name: "Agriculture & Food", kinds: ["agricultural", "food", "seed", "natural"] },
  { code: "VICE", name: "Vice & Pharma", kinds: ["drug", "vice"] },
  { code: "INDL", name: "Industrial", kinds: ["raw materials", "scrap", "man-made", "crafting", "explosive"] },
  { code: "MISC", name: "Frontier Misc", kinds: [] }, // fallback
];

const kindLookup = new Map<string, SectorCode>();
for (const s of SECTORS) for (const k of s.kinds) kindLookup.set(k, s.code);

export function kindToSector(kind: string | null | undefined): SectorCode {
  if (!kind) return "MISC";
  return kindLookup.get(kind.trim().toLowerCase()) ?? "MISC";
}

export type IndexPoint = { time: number; value: number };
export type IndexSeries = Partial<Record<SectorCode, IndexPoint[]>>;
export type IndexLatest = { sector: SectorCode; value: number; constituents: number };
