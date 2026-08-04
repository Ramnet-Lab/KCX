"use client";

import type {
  BazaarListingDto,
  BazaarSaleDto,
  BazaarThreadDto,
  ContractDto,
  PriceAlertDto,
  ServiceContractDto,
  WatchEntryDto,
} from "@kcx/db";
import { BAZAAR_CATEGORY_LABELS, type BazaarCategory, type OrderDto } from "@kcx/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { BazaarThreadPanel } from "@/components/bazaar-thread";
import { StarPicker } from "@/components/trader-standing";
import { WatchlistPanel } from "@/components/watchlist";
import { fmtAuec, timeLeft } from "@/lib/countdown";

type Tab = "messages" | "selling" | "sales" | "contracts" | "orders" | "watchlist";

/**
 * The trader's own desk.
 *
 * Each section shows what NEEDS DOING first — a sale waiting on your confirmation, a
 * contract mid-flight — and the finished record underneath. The ordering is the point: the
 * things that expire if ignored are the things that must not be scrolled past.
 */
export function ManageDesk({
  listings,
  sales,
  serviceContracts,
  orders,
  escrows,
  threads,
  watchlist,
  alerts,
  pendingRatings,
}: {
  listings: BazaarListingDto[];
  sales: BazaarSaleDto[];
  serviceContracts: ServiceContractDto[];
  orders: OrderDto[];
  escrows: ContractDto[];
  threads: BazaarThreadDto[];
  watchlist: WatchEntryDto[];
  alerts: PriceAlertDto[];
  pendingRatings: { saleId: string; counterpartyName: string; title: string }[];
}) {
  // Conversations open first when any are waiting: somebody is holding a question, and an
  // unanswered buyer goes back to Discord and doesn't return.
  const [tab, setTab] = useState<Tab>(
    threads.some((t) => t.unread) ? "messages" : alerts.some((a) => !a.read) ? "watchlist" : "selling",
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const call = async (id: string, url: string, init: RequestInit) => {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(url, init);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? "That didn't work");
      else router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const patch = (id: string, url: string, payload: unknown) =>
    call(id, url, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

  // Badge counts are "needs you", not totals: a number that only ever grows stops meaning
  // anything, and the point of the badge is to pull someone to the tab with work in it.
  const counts = useMemo(
    () => ({
      messages: threads.filter((t) => t.unread).length,
      watchlist: alerts.filter((a) => !a.read).length,
      selling: listings.filter((l) => l.status === "active" || l.status === "paused").length,
      sales: sales.filter((s) => s.status === "pending" && !(s.isSeller ? s.sellerConfirmed : s.buyerConfirmed)).length,
      contracts: serviceContracts.filter(
        (c) =>
          c.status === "in_progress" && (c.isIssuer ? !c.issuerConfirmed : c.isExecutor ? !c.executorConfirmed : false),
      ).length,
      orders:
        escrows.filter((e) => e.status === "escrow" && !e.iConfirmed).length +
        orders.filter((o) => o.status === "active" || o.status === "paused").length,
    }),
    [listings, sales, serviceContracts, orders, escrows, threads, alerts],
  );

  const TABS: { id: Tab; label: string; count: number }[] = [
    { id: "messages", label: "Messages", count: counts.messages },
    { id: "selling", label: "Selling", count: counts.selling },
    { id: "sales", label: "Bazaar sales", count: counts.sales },
    { id: "contracts", label: "Contracts", count: counts.contracts },
    { id: "orders", label: "Market orders", count: counts.orders },
    { id: "watchlist", label: "Watchlist", count: counts.watchlist },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1 border-b border-line pb-2 text-xs">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`tap rounded px-3 py-1.5 font-bold ${
              tab === t.id ? "bg-accent/15 text-accent" : "text-ink-faint hover:text-ink-dim"
            }`}
          >
            {t.label}
            {t.count > 0 && <span className="num ml-1.5 text-ink-dim">{t.count}</span>}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-3 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>
      )}

      {pendingRatings.length > 0 && tab === "sales" && (
        <RateSales pending={pendingRatings} onDone={() => router.refresh()} />
      )}

      {tab === "messages" && <MessagesTab threads={threads} onChanged={() => router.refresh()} />}
      {tab === "selling" && <SellingTab listings={listings} busy={busy} onAct={patch} />}
      {tab === "sales" && <SalesTab sales={sales} busy={busy} onAct={patch} />}
      {tab === "contracts" && <ContractsTab contracts={serviceContracts} busy={busy} onAct={patch} />}
      {tab === "orders" && <OrdersTab orders={orders} escrows={escrows} busy={busy} onAct={patch} />}
      {tab === "watchlist" && <WatchlistPanel entries={watchlist} alerts={alerts} />}
    </div>
  );
}

type ActFn = (id: string, url: string, payload: unknown) => Promise<void>;

const btn = "tap rounded border border-line px-2 py-1 text-ink-dim hover:text-ink disabled:opacity-40";
const btnDanger = "tap rounded border border-line px-2 py-1 text-ink-faint hover:text-danger disabled:opacity-40";
const btnGo = "tap rounded bg-up/20 px-2 py-1 font-bold text-up hover:bg-up/30 disabled:opacity-40";

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border border-dashed border-line p-8 text-center text-sm text-ink-faint">{children}</div>
  );
}

/* --------------------------------- Messages --------------------------------- */

/**
 * Conversations, master–detail.
 *
 * Unread first regardless of recency: the ordering people need is "who is waiting on me",
 * not "what happened last". A busy seller scrolling a chronological list to find the one
 * question nobody answered is how the question stays unanswered.
 */
function MessagesTab({ threads, onChanged }: { threads: BazaarThreadDto[]; onChanged: () => void }) {
  const ordered = useMemo(
    () =>
      [...threads].sort((a, b) => {
        if (a.unread !== b.unread) return a.unread ? -1 : 1;
        return b.lastMessageAt.localeCompare(a.lastMessageAt);
      }),
    [threads],
  );
  const [selected, setSelected] = useState<string | null>(ordered[0]?.id ?? null);

  if (threads.length === 0) {
    return (
      <Empty>
        <p className="mb-1 text-ink">No conversations.</p>
        <p>When somebody asks about one of your listings — or you ask about theirs — it lands here.</p>
      </Empty>
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <div className="max-h-[32rem] space-y-1 overflow-y-auto">
        {ordered.map((t) => (
          <button
            key={t.id}
            onClick={() => setSelected(t.id)}
            className={`tap w-full rounded border p-2 text-left ${
              selected === t.id ? "border-accent/60 bg-panel-2" : "border-line bg-panel hover:border-ink-faint"
            }`}
          >
            <div className="flex items-start gap-2">
              {t.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/uploads/bazaar/${t.thumbnail}`}
                  alt=""
                  className="h-8 w-8 shrink-0 rounded border border-line object-cover"
                />
              ) : (
                <span className="h-8 w-8 shrink-0 rounded border border-line bg-panel-2" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-bold text-ink">{t.listingTitle}</span>
                <span className="block truncate text-[11px] text-ink-faint">
                  {t.isOwner ? "from" : "with"} {t.otherPartyName}
                  {t.listingIntent === "buy" && " · wanted ad"}
                </span>
              </span>
              {t.unread && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="unread" />}
            </div>
          </button>
        ))}
      </div>

      <div className="rounded border border-line bg-panel p-3">
        {selected ? (
          <>
            <Link
              href={`/bazaar/${ordered.find((t) => t.id === selected)?.listingId ?? ""}`}
              className="mb-2 inline-block text-xs text-ink-faint hover:text-accent"
            >
              open the listing ↗
            </Link>
            <BazaarThreadPanel key={selected} threadId={selected} onChanged={onChanged} />
          </>
        ) : (
          <p className="text-xs text-ink-faint">Pick a conversation.</p>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------- Selling --------------------------------- */

function SellingTab({
  listings,
  busy,
  onAct,
}: {
  listings: BazaarListingDto[];
  busy: string | null;
  onAct: ActFn;
}) {
  if (listings.length === 0) {
    return (
      <Empty>
        <p className="mb-1 text-ink">You haven&apos;t listed anything.</p>
        <p>
          <Link href="/bazaar" className="text-accent hover:underline">
            Go to the bazaar
          </Link>{" "}
          to sell a ship, components, or something you crafted.
        </p>
      </Empty>
    );
  }

  const live = listings.filter((l) => l.status === "active" || l.status === "paused");
  const ended = listings.filter((l) => !(l.status === "active" || l.status === "paused"));

  return (
    <div className="space-y-4">
      <Section title="On the board" count={live.length}>
        {live.map((l) => (
          <ListingRow key={l.id} listing={l} busy={busy} onAct={onAct} />
        ))}
      </Section>
      {ended.length > 0 && (
        <Section title="Ended" count={ended.length}>
          {ended.map((l) => (
            <ListingRow key={l.id} listing={l} busy={busy} onAct={onAct} />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <section>
      <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-faint">
        {title} <span className="num text-ink-dim">{count}</span>
      </h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function ListingRow({ listing: l, busy, onAct }: { listing: BazaarListingDto; busy: string | null; onAct: ActFn }) {
  const isAuction = l.listingType !== "buy_now";
  const live = l.status === "active" || l.status === "paused";
  const ended = ["expired", "cancelled", "sold_out"].includes(l.status);

  return (
    <article className="flex flex-wrap items-center gap-3 rounded border border-line bg-panel p-3">
      <Link href={`/bazaar/${l.id}`} className="shrink-0">
        {l.images[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/uploads/bazaar/${l.images[0]}`}
            alt=""
            className="h-14 w-14 rounded border border-line object-cover"
          />
        ) : (
          <span className="flex h-14 w-14 items-center justify-center rounded border border-line bg-panel-2 text-[10px] text-ink-faint">
            no photo
          </span>
        )}
      </Link>

      <div className="min-w-48 flex-1">
        <Link href={`/bazaar/${l.id}`} className="text-sm font-bold text-ink hover:text-accent">
          {l.title}
        </Link>
        <div className="text-[11px] text-ink-faint">
          {BAZAAR_CATEGORY_LABELS[l.category as BazaarCategory] ?? l.category}
          {" · "}
          {isAuction
            ? `${l.bidCount} bid${l.bidCount === 1 ? "" : "s"}`
            : `${l.remainingQuantity} of ${l.quantity} left`}
          {live && (
            <>
              {" · "}
              <span suppressHydrationWarning>{timeLeft(isAuction ? l.auctionEndsAt : l.expiresAt)}</span>
            </>
          )}
          {l.status !== "active" && ` · ${l.status.replace(/_/g, " ")}`}
        </div>
      </div>

      <span className="num text-sm font-bold text-up">
        {fmtAuec(l.currentBid ?? l.buyNowPrice ?? l.startPrice ?? 0)} aUEC
      </span>

      <div className="flex flex-wrap gap-1.5 text-[11px]">
        {l.status === "active" && l.listingType === "buy_now" && (
          <button onClick={() => onAct(l.id, `/api/bazaar/${l.id}`, { action: "pause" })} disabled={busy === l.id} className={btn}>
            pause
          </button>
        )}
        {l.status === "paused" && (
          <button onClick={() => onAct(l.id, `/api/bazaar/${l.id}`, { action: "resume" })} disabled={busy === l.id} className={btn}>
            resume
          </button>
        )}
        {l.status === "active" && (
          <button onClick={() => onAct(l.id, `/api/bazaar/${l.id}`, { action: "bump" })} disabled={busy === l.id} className={btn}>
            bump
          </button>
        )}
        {ended && (
          <button
            onClick={() => onAct(l.id, `/api/bazaar/${l.id}`, { action: "relist", runForHours: 168 })}
            disabled={busy === l.id}
            className="tap rounded bg-accent/20 px-2 py-1 font-bold text-accent hover:bg-accent/30 disabled:opacity-40"
          >
            relist 7d
          </button>
        )}
        <Link href={`/bazaar/${l.id}`} className={btn}>
          edit
        </Link>
        {live && (
          <button onClick={() => onAct(l.id, `/api/bazaar/${l.id}`, { action: "cancel" })} disabled={busy === l.id} className={btnDanger}>
            take down
          </button>
        )}
      </div>
    </article>
  );
}

/* ----------------------------------- Sales ---------------------------------- */

function SalesTab({ sales, busy, onAct }: { sales: BazaarSaleDto[]; busy: string | null; onAct: ActFn }) {
  if (sales.length === 0) {
    return <Empty>Nothing bought or sold on the bazaar yet.</Empty>;
  }
  const pending = sales.filter((s) => s.status === "pending");
  const done = sales.filter((s) => s.status !== "pending");

  return (
    <div className="space-y-4">
      <Section title="Waiting to settle" count={pending.length}>
        {pending.map((s) => (
          <SaleRow key={s.id} sale={s} busy={busy} onAct={onAct} />
        ))}
      </Section>
      {done.length > 0 && (
        <Section title="History" count={done.length}>
          {done.map((s) => (
            <SaleRow key={s.id} sale={s} busy={busy} onAct={onAct} />
          ))}
        </Section>
      )}
    </div>
  );
}

function SaleRow({ sale: s, busy, onAct }: { sale: BazaarSaleDto; busy: string | null; onAct: ActFn }) {
  const iConfirmed = s.isSeller ? s.sellerConfirmed : s.buyerConfirmed;
  const theyConfirmed = s.isSeller ? s.buyerConfirmed : s.sellerConfirmed;
  const pending = s.status === "pending";

  return (
    <article
      className={`flex flex-wrap items-center gap-3 rounded border p-3 ${
        pending && !iConfirmed ? "border-accent/40" : "border-line"
      } bg-panel`}
    >
      <Link href={`/bazaar/${s.listingId}`} className="shrink-0">
        {s.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/uploads/bazaar/${s.thumbnail}`}
            alt=""
            className="h-14 w-14 rounded border border-line object-cover"
          />
        ) : (
          <span className="flex h-14 w-14 items-center justify-center rounded border border-line bg-panel-2 text-[10px] text-ink-faint">
            no photo
          </span>
        )}
      </Link>

      <div className="min-w-48 flex-1">
        <Link href={`/bazaar/${s.listingId}`} className="text-sm font-bold text-ink hover:text-accent">
          {s.title}
        </Link>
        <div className="text-[11px] text-ink-faint">
          <span className={s.isSeller ? "text-up" : "text-accent"}>{s.isSeller ? "selling to" : "buying from"}</span>{" "}
          <span className="text-ink-dim">{s.counterpartyName}</span>
          {s.quantity > 1 && ` · ${s.quantity} × ${fmtAuec(s.unitPrice)}`}
          {s.origin === "auction" && " · won at auction"}
          {pending ? (
            <>
              {" · "}
              <span suppressHydrationWarning>{timeLeft(s.settleBy)} to confirm</span>
            </>
          ) : (
            ` · ${s.status}`
          )}
        </div>
        {pending && (
          <div className="mt-0.5 text-[11px] text-ink-faint">
            {iConfirmed && theyConfirmed
              ? "settling"
              : iConfirmed
                ? "you confirmed — waiting on them"
                : theyConfirmed
                  ? "they confirmed — waiting on you"
                  : "meet in-game, then you both confirm here"}
          </div>
        )}
      </div>

      <span className="num text-sm font-bold text-up">{fmtAuec(s.totalPrice)} aUEC</span>

      {pending && (
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          <button
            onClick={() => onAct(s.id, `/api/bazaar/sales/${s.id}`, { action: "confirm" })}
            disabled={busy === s.id || iConfirmed}
            className={`${btnGo} disabled:cursor-default disabled:bg-panel-2 disabled:text-ink-faint`}
          >
            {iConfirmed ? "✓ confirmed" : s.isSeller ? "handed it over" : "got it"}
          </button>
          <button
            onClick={() => onAct(s.id, `/api/bazaar/sales/${s.id}`, { action: "cancel" })}
            disabled={busy === s.id}
            className={btnDanger}
          >
            back out
          </button>
        </div>
      )}
    </article>
  );
}

function RateSales({
  pending,
  onDone,
}: {
  pending: { saleId: string; counterpartyName: string; title: string }[];
  onDone: () => void;
}) {
  const [stars, setStars] = useState<Record<string, number>>({});
  const [done, setDone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const outstanding = pending.filter((p) => !done.has(p.saleId));
  if (outstanding.length === 0) return null;

  const submit = async (saleId: string) => {
    const value = stars[saleId];
    if (!value) return;
    setBusy(saleId);
    try {
      const res = await fetch(`/api/bazaar/sales/${saleId}/rate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stars: value }),
      });
      if (res.ok) {
        setDone((d) => new Set(d).add(saleId));
        onDone();
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mb-4">
      <h2 className="mb-2 text-sm font-bold text-ink">Rate settled sales ({outstanding.length})</h2>
      <div className="space-y-2">
        {outstanding.map((p) => (
          <div
            key={p.saleId}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded border border-line bg-panel p-3 text-sm"
          >
            <span className="text-ink">
              <span className="font-bold">{p.counterpartyName}</span>
              <span className="ml-2 text-xs text-ink-faint">{p.title}</span>
            </span>
            <span className="ml-auto flex items-center gap-2">
              <StarPicker
                value={stars[p.saleId] ?? 0}
                onChange={(v) => setStars((s) => ({ ...s, [p.saleId]: v }))}
                disabled={busy === p.saleId}
              />
              <button
                onClick={() => submit(p.saleId)}
                disabled={!stars[p.saleId] || busy === p.saleId}
                className="tap rounded border border-accent/60 px-3 py-1 text-xs font-bold text-accent hover:bg-accent/10 disabled:opacity-40"
              >
                Submit
              </button>
            </span>
          </div>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-ink-faint">
        Bazaar ratings are tracked separately from contracts and commodity trading.
      </p>
    </section>
  );
}

/* --------------------------------- Contracts -------------------------------- */

function ContractsTab({
  contracts,
  busy,
  onAct,
}: {
  contracts: ServiceContractDto[];
  busy: string | null;
  onAct: ActFn;
}) {
  if (contracts.length === 0) {
    return (
      <Empty>
        <p className="mb-1 text-ink">No contracts.</p>
        <p>
          <Link href="/contracts" className="text-accent hover:underline">
            Post one
          </Link>{" "}
          or take somebody else&apos;s.
        </p>
      </Empty>
    );
  }

  const live = contracts.filter((c) => ["open", "bidding", "awarded", "in_progress"].includes(c.status));
  const done = contracts.filter((c) => !["open", "bidding", "awarded", "in_progress"].includes(c.status));

  return (
    <div className="space-y-4">
      <Section title="Live" count={live.length}>
        {live.map((c) => (
          <ContractRow key={c.id} contract={c} busy={busy} onAct={onAct} />
        ))}
      </Section>
      {done.length > 0 && (
        <Section title="History" count={done.length}>
          {done.map((c) => (
            <ContractRow key={c.id} contract={c} busy={busy} onAct={onAct} />
          ))}
        </Section>
      )}
    </div>
  );
}

function ContractRow({
  contract: c,
  busy,
  onAct,
}: {
  contract: ServiceContractDto;
  busy: string | null;
  onAct: ActFn;
}) {
  const iConfirmed = c.isIssuer ? c.issuerConfirmed : c.executorConfirmed;
  const canCancel = ["open", "bidding", "awarded", "in_progress"].includes(c.status);

  return (
    <article
      className={`flex flex-wrap items-center gap-3 rounded border p-3 ${
        c.status === "in_progress" && !iConfirmed ? "border-accent/40" : "border-line"
      } bg-panel`}
    >
      <div className="min-w-48 flex-1">
        <span className="text-sm font-bold text-ink">{c.title}</span>
        <div className="text-[11px] text-ink-faint">
          <span className={c.isIssuer ? "text-accent" : "text-up"}>{c.isIssuer ? "you issued" : "you took"}</span>
          {c.category && ` · ${c.category}`}
          {` · ${c.status.replace(/_/g, " ")}`}
          {c.expiresAt && (
            <>
              {" · "}
              <span suppressHydrationWarning>{timeLeft(c.expiresAt)}</span>
            </>
          )}
        </div>
      </div>

      <span className="num text-sm font-bold text-up">{fmtAuec(c.awardedAmount ?? c.payout)} aUEC</span>

      <div className="flex flex-wrap gap-1.5 text-[11px]">
        {c.status === "in_progress" && (
          <button
            onClick={() => onAct(c.id, `/api/service-contracts/${c.id}`, { action: "confirm" })}
            disabled={busy === c.id || iConfirmed}
            className={`${btnGo} disabled:cursor-default disabled:bg-panel-2 disabled:text-ink-faint`}
          >
            {iConfirmed ? "✓ confirmed" : c.isExecutor ? "mark done" : "confirm done"}
          </button>
        )}
        <Link href="/contracts" className={btn}>
          open
        </Link>
        {canCancel && (
          <button
            onClick={() => onAct(c.id, `/api/service-contracts/${c.id}`, { action: "cancel" })}
            disabled={busy === c.id}
            className={btnDanger}
          >
            {c.isExecutor && c.status === "in_progress" ? "step away" : "withdraw"}
          </button>
        )}
      </div>
    </article>
  );
}

/* ---------------------------------- Orders ---------------------------------- */

function OrdersTab({
  orders,
  escrows,
  busy,
  onAct,
}: {
  orders: OrderDto[];
  escrows: ContractDto[];
  busy: string | null;
  onAct: ActFn;
}) {
  const open = escrows.filter((e) => e.status === "escrow");
  const live = orders.filter((o) => o.status === "active" || o.status === "paused");
  const done = orders.filter((o) => !(o.status === "active" || o.status === "paused"));

  if (orders.length === 0 && escrows.length === 0) {
    return (
      <Empty>
        <p className="mb-1 text-ink">No orders.</p>
        <p>
          Post one from the{" "}
          <Link href="/" className="text-accent hover:underline">
            market wall
          </Link>{" "}
          or the{" "}
          <Link href="/orders" className="text-accent hover:underline">
            order board
          </Link>
          .
        </p>
      </Empty>
    );
  }

  return (
    <div className="space-y-4">
      <Section title="Escrows in flight" count={open.length}>
        {open.map((e) => (
          <article
            key={e.id}
            className={`flex flex-wrap items-center gap-3 rounded border p-3 ${
              e.iConfirmed ? "border-line" : "border-accent/40"
            } bg-panel`}
          >
            <div className="min-w-48 flex-1">
              <span className="text-sm font-bold text-ink">{e.commodityName}</span>
              <div className="text-[11px] text-ink-faint">
                {e.iDeliverCargo ? "you deliver cargo" : "you pay"} · {e.quantityScu} SCU @{" "}
                {fmtAuec(e.pricePerScu)} · with <span className="text-ink-dim">{e.counterpartyDisplayName}</span> ·{" "}
                <span suppressHydrationWarning>{timeLeft(e.expiresAt)}</span>
              </div>
            </div>
            <span className="num text-sm font-bold text-up">{fmtAuec(e.value)} aUEC</span>
            <Link href="/orders" className={btn}>
              open
            </Link>
          </article>
        ))}
      </Section>

      <Section title="Resting orders" count={live.length}>
        {live.map((o) => (
          <OrderRow key={o.id} order={o} busy={busy} onAct={onAct} />
        ))}
      </Section>

      {done.length > 0 && (
        <Section title="History" count={done.length}>
          {done.map((o) => (
            <OrderRow key={o.id} order={o} busy={busy} onAct={onAct} />
          ))}
        </Section>
      )}
    </div>
  );
}

function OrderRow({ order: o, busy, onAct }: { order: OrderDto; busy: string | null; onAct: ActFn }) {
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState(String(o.pricePerScu));
  const [quantity, setQuantity] = useState(String(o.quantityScu));
  const live = o.status === "active" || o.status === "paused";

  const save = async () => {
    await onAct(o.id, `/api/orders/${o.id}`, {
      action: "edit",
      edit: { pricePerScu: Math.round(Number(price)), quantityScu: Math.round(Number(quantity)) },
    });
    setEditing(false);
  };

  return (
    <article className="rounded border border-line bg-panel p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
            o.side === "buy" ? "bg-up/15 text-up" : "bg-down/15 text-down"
          }`}
        >
          {o.side === "buy" ? "WTB" : "WTS"}
        </span>
        <Link href={`/commodities/${o.commoditySlug}`} className="text-sm font-bold text-ink hover:text-accent">
          {o.commodityName}
        </Link>
        <span className="num text-xs text-ink-dim">
          {o.remainingScu} of {o.quantityScu} SCU @ {fmtAuec(o.pricePerScu)}
        </span>
        {o.reservedScu > 0 && (
          <span className="num rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold text-accent">
            {o.reservedScu} SCU in contract
          </span>
        )}
        <span className="text-[11px] text-ink-faint">
          {live ? <span suppressHydrationWarning>{timeLeft(o.expiresAt)}</span> : o.status.replace(/_/g, " ")}
        </span>
        <span className="num ml-auto text-sm font-bold text-up">
          {fmtAuec(o.pricePerScu * o.remainingScu)} aUEC
        </span>
      </div>

      {live && (
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
          <button onClick={() => setEditing((v) => !v)} className={btn}>
            {editing ? "cancel edit" : "edit"}
          </button>
          {o.status === "active" && (
            <button onClick={() => onAct(o.id, `/api/orders/${o.id}`, { action: "pause" })} disabled={busy === o.id} className={btn}>
              pause
            </button>
          )}
          {o.status === "paused" && (
            <button onClick={() => onAct(o.id, `/api/orders/${o.id}`, { action: "resume" })} disabled={busy === o.id} className={btn}>
              resume
            </button>
          )}
          <button onClick={() => onAct(o.id, `/api/orders/${o.id}`, { action: "bump" })} disabled={busy === o.id} className={btn}>
            bump
          </button>
          <button onClick={() => onAct(o.id, `/api/orders/${o.id}`, { action: "cancel" })} disabled={busy === o.id} className={btnDanger}>
            cancel
          </button>
        </div>
      )}

      {editing && (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded border border-line bg-panel-2 p-2">
          <label className="w-32">
            <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Price / SCU</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="num mt-1 w-full rounded border border-line bg-bg px-2 py-1 text-right text-sm text-ink focus:outline-none"
            />
          </label>
          <label className="w-32">
            <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">Total SCU</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="num mt-1 w-full rounded border border-line bg-bg px-2 py-1 text-right text-sm text-ink focus:outline-none"
            />
          </label>
          <button
            onClick={save}
            disabled={busy === o.id || !(Number(price) > 0 && Number(quantity) > 0)}
            className="tap rounded bg-accent/20 px-3 py-1 text-xs font-bold text-accent hover:bg-accent/30 disabled:opacity-40"
          >
            Save
          </button>
          <span className="text-[11px] text-ink-faint">
            Revising re-checks your collateral, same as posting it did.
          </span>
        </div>
      )}
    </article>
  );
}
