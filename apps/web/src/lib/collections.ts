/**
 * Client-side collections (watchlists): commodity ids grouped under named collections,
 * persisted in localStorage until accounts exist (M5) — then these migrate server-side.
 */

export type Collection = {
  id: string;
  name: string;
  commodityIds: number[];
};

const COLLECTIONS_KEY = "kcx.collections.v1";
const VIEW_KEY = "kcx.marketwall.view";

export function loadCollections(): Collection[] {
  try {
    const raw = localStorage.getItem(COLLECTIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is Collection =>
        typeof c === "object" && c !== null &&
        typeof (c as Collection).id === "string" &&
        typeof (c as Collection).name === "string" &&
        Array.isArray((c as Collection).commodityIds),
    );
  } catch {
    return [];
  }
}

export function saveCollections(collections: Collection[]): void {
  try {
    localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(collections));
  } catch {
    /* storage full/blocked — collections just won't persist */
  }
}

export type WallView = "tiles" | "list";

export function loadView(): WallView {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "tiles";
  } catch {
    return "tiles";
  }
}

export function saveView(view: WallView): void {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    /* ignore */
  }
}

export function newCollectionId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
