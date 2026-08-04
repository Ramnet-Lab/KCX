import type { Metadata } from "next";
import Link from "next/link";
import { DeskNavLink, ModNavLink, SessionBar } from "@/components/session-bar";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "KCX — Kestrel Commodities Exchange",
    template: "%s · KCX",
  },
  description:
    "Player-driven commodities exchange for Star Citizen: live NPC terminal prices, charts, and a player order board. Unofficial fan project.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* overflow-x-clip: wide tables/charts scroll inside their own containers, so the page
          itself must never scroll sideways — that pushed the nav (and sign-in) off screen. */}
      <body className="min-h-screen overflow-x-clip font-mono text-sm antialiased">
        <header className="border-b border-line bg-panel">
          {/* flex-wrap so the nav drops to a second line on a phone instead of off the edge. */}
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="text-base font-bold tracking-widest text-accent">
              KCX
            </Link>
            <span className="hidden text-ink-dim lg:inline">Kestrel Commodities Exchange</span>
            <nav className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2 text-ink-dim">
              <Link href="/commodities" className="hover:text-ink">
                Commodities
              </Link>
              <Link href="/orders" className="hover:text-ink">
                Order board
              </Link>
              <Link href="/contracts" className="hover:text-ink">
                Contracts
              </Link>
              <Link href="/bazaar" className="hover:text-ink">
                Bazaar
              </Link>
              <Link href="/orgs/directory" className="hover:text-ink">
                Orgs
              </Link>
              <DeskNavLink />
              <ModNavLink />
              <SessionBar />
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        <footer className="mt-12 border-t border-line bg-panel text-xs leading-relaxed text-ink-dim">
          <div className="mx-auto max-w-6xl space-y-2 px-4 py-6">
            <p>
              This is an unofficial{" "}
              <a href="https://robertsspaceindustries.com" className="underline hover:text-ink" rel="noopener">
                Star Citizen
              </a>{" "}
              fan site, not affiliated with the Cloud Imperium group of companies. All content on
              this site not authored by its host or users are property of their respective owners.
            </p>
            <p>
              Star Citizen®, Squadron 42®, Roberts Space Industries®, and Cloud Imperium® are
              registered trademarks of Cloud Imperium Rights LLC.
            </p>
            <p>
              NPC terminal price data powered by the{" "}
              <a href="https://uexcorp.space" className="underline hover:text-ink" rel="noopener">
                UEX API
              </a>{" "}
              (community-crowdsourced; may not reflect live servers). KCX never holds aUEC or
              cargo — all player trades settle in-game, bilaterally, at your own risk. In-game
              currency only; real-money trading is banned.
            </p>
            <p className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
              <Link href="/about" className="hover:text-ink">
                About
              </Link>
              <Link href="/terms" className="hover:text-ink">
                Terms of use
              </Link>
              <Link href="/privacy" className="hover:text-ink">
                Privacy
              </Link>
              <Link href="/credits" className="hover:text-ink">
                Credits
              </Link>
              <Link href="/developers" className="hover:text-ink">
                API
              </Link>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
