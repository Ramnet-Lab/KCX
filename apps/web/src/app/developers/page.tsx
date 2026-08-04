import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Developers",
  description:
    "Free public API for player-settled Star Citizen prices — commodity marks, the trade tape, and bazaar item history. Open CORS, no key required.",
};

const ENDPOINTS: { method: string; path: string; blurb: string; example?: string }[] = [
  { method: "GET", path: "/api/v1", blurb: "Discovery: every endpoint, plus how the numbers are computed." },
  {
    method: "GET",
    path: "/api/v1/commodities",
    blurb: "Every commodity with its current player mark, 24h change, and NPC reference prices.",
    example: "?playerPriced=1",
  },
  { method: "GET", path: "/api/v1/commodities/{slug}", blurb: "One commodity in full." },
  {
    method: "GET",
    path: "/api/v1/commodities/{slug}/prints",
    blurb: "The tape: settled player trades, including withheld ones and why.",
    example: "?limit=100",
  },
  { method: "GET", path: "/api/v1/items", blurb: "Bazaar item catalogue search.", example: "?q=cutlass" },
  { method: "GET", path: "/api/v1/items/{id}/prices", blurb: "Settled bazaar sale history for one item." },
  {
    method: "GET",
    path: "/api/v1/prints.csv",
    blurb: "Bulk download of the whole tape. No handles — see below.",
    example: "?since=2026-01-01",
  },
];

/**
 * The developer page.
 *
 * Published deliberately rather than as a courtesy: a price feed whose method nobody can
 * read is an assertion, and the one thing here that exists nowhere else is a price derived
 * from settled player trades. Anyone should be able to check it, or build on it, without
 * asking us.
 */
export default function DevelopersPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-lg font-bold text-ink">Developers</h1>
      <p className="mt-1 text-xs leading-relaxed text-ink-dim">
        KCX publishes the price Star Citizen players actually trade at — not what they are
        asking. It is free, needs no key, and is open to cross-origin requests so browser
        tools can read it directly. If you build something with it, a link back is all we ask.
      </p>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-bold text-ink">Endpoints</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-xs">
            <thead>
              <tr className="border-b border-line text-left text-ink-faint">
                <th className="py-1 pr-3 font-normal">Method</th>
                <th className="py-1 pr-3 font-normal">Path</th>
                <th className="py-1 font-normal">What it gives you</th>
              </tr>
            </thead>
            <tbody>
              {ENDPOINTS.map((e) => (
                <tr key={e.path} className="border-b border-line/50 align-top">
                  <td className="py-1.5 pr-3 text-ink-faint">{e.method}</td>
                  <td className="py-1.5 pr-3">
                    <code className="text-accent">{e.path}</code>
                    {e.example && <code className="block text-[10px] text-ink-faint">{e.example}</code>}
                  </td>
                  <td className="py-1.5 text-ink-dim">{e.blurb}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6 rounded border border-line bg-panel p-4">
        <h2 className="mb-2 text-sm font-bold text-ink">What the numbers mean</h2>
        <dl className="space-y-2 text-xs text-ink-dim">
          <div>
            <dt className="font-bold text-ink">mark</dt>
            <dd>
              The player price: a volume-weighted average of qualifying fills over 72 hours,
              falling back to the last qualifying fill, falling back to the best NPC terminal
              price as a seed. Only a dual-confirmed settlement prints. Posting an order moves
              nothing; an order that expires unfilled moves nothing.
            </dd>
          </div>
          <div>
            <dt className="font-bold text-ink">hasPlayerPrice</dt>
            <dd>
              False means the mark is still the NPC seed and no player trade has happened. This
              is usually the field you want — quoting a seeded price as a player price is the
              easiest mistake to make with this feed.
            </dd>
          </div>
          <div>
            <dt className="font-bold text-ink">thin</dt>
            <dd>
              Fewer than two distinct counterparty pairs stand behind the price. The flag never
              suppresses it — hiding a manipulated price conceals the manipulation rather than
              exposing it.
            </dd>
          </div>
          <div>
            <dt className="font-bold text-ink">excluded / exclusionReason</dt>
            <dd>
              A print kept for audit but withheld from the mark: an unverified party, a price
              outside 0.25×–3.0× the same-side reference, a pair printing more than three times
              for one commodity in seven days, or one account exceeding 70% of window volume.
              Nothing is ever deleted.
            </dd>
          </div>
          <div>
            <dt className="font-bold text-ink">Bazaar item prices</dt>
            <dd>
              Settled sales only, per unit. Asking prices are never counted — an unsold listing
              tells you its price was too high and nothing else.
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-[11px] text-ink-faint">
          The full method, including why each rule exists, is in{" "}
          <code className="text-ink-dim">docs/market-model.md</code> and{" "}
          <code className="text-ink-dim">docs/bazaar.md</code> in the repository.
        </p>
      </section>

      <section className="mt-6 rounded border border-line bg-panel p-4">
        <h2 className="mb-2 text-sm font-bold text-ink">Privacy in the bulk export</h2>
        <p className="text-xs leading-relaxed text-ink-dim">
          The per-commodity tape names both traders, because checking a specific price means
          checking who traded it, and those handles are already on the commodity page.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-ink-dim">
          <code className="text-accent">prints.csv</code> does not. A whole-history file is a
          different object from a single page: it is about prices, and publishing one that makes
          mass profiling of individual traders trivial is not the same as being auditable. Each
          row instead carries a <code className="text-ink">pair_key</code> — a stable,
          order-independent hash of the two counterparties — so anyone reproducing the integrity
          rules can still group trades by relationship without anybody being named.
        </p>
      </section>

      <section className="mt-6 rounded border border-line bg-panel p-4">
        <h2 className="mb-2 text-sm font-bold text-ink">Limits and stability</h2>
        <ul className="list-inside list-disc space-y-1 text-xs text-ink-dim">
          <li>
            <span className="text-ink">No rate limit is enforced.</span> Page sizes are capped
            instead. We would rather say that plainly than run an in-process counter that resets
            on every deploy and calls itself a quota. Please cache; the marks move at most every
            30 minutes unless something settles.
          </li>
          <li>
            <span className="text-ink">/api/v1 shapes are a promise.</span> Fields get added,
            never repurposed or removed. A breaking change would go to /api/v2.
          </li>
          <li>Responses carry attribution in a `notice` object. Leave it in if you redistribute.</li>
          <li>
            NPC terminal prices are reference data from the{" "}
            <a href="https://uexcorp.space" className="text-accent hover:underline" rel="noopener">
              UEX API
            </a>{" "}
            and are credited as theirs. The player marks and bazaar history are ours.
          </li>
        </ul>
      </section>

      <p className="mt-6 text-xs text-ink-faint">
        Start at{" "}
        <Link href="/api/v1" className="text-accent hover:underline">
          /api/v1
        </Link>
        .
      </p>
    </div>
  );
}
