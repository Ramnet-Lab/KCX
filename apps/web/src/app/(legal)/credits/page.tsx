import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Credits",
  description: "The data and projects the Kestrel Commodities Exchange is built on.",
};

export default function CreditsPage() {
  return (
    <>
      <h1 className="text-lg font-bold text-ink">Credits</h1>
      <p>KCX is assembled almost entirely from other people&apos;s work.</p>

      <h2>UEX</h2>
      <p>
        Every NPC terminal price on this site comes from the{" "}
        <a href="https://uexcorp.space" rel="noopener">
          UEX Corp
        </a>{" "}
        API — a community dataset maintained by volunteer datarunners who fly out and record
        prices by hand, because the game publishes none. Without it the price half of this site
        would not exist.
      </p>
      <p>
        We poll the public endpoint every 30 minutes — roughly 48 requests a day against a quota
        of 172,800 — and cache everything locally so pages never re-query upstream. Prices shown
        here are UEX&apos;s, may lag live servers, and any error in them is ours to report rather
        than theirs to answer for.
      </p>

      <h2>Star Citizen Wiki / scunpacked</h2>
      <p>
        Commodity master data — names, codes, categories, legality — is reconciled against the{" "}
        <a href="https://github.com/StarCitizenWiki/scunpacked-data" rel="noopener">
          scunpacked-data
        </a>{" "}
        dump maintained by the Star Citizen Wiki project. Wiki content is licensed CC-BY-SA.
      </p>

      <h2>Cloud Imperium</h2>
      <p>
        Star Citizen and everything in it are the property of Cloud Imperium Rights LLC. KCX is an
        unofficial fan project with no affiliation. Any imagery used comes from the official Fan
        Kit. Nothing here is datamined from game files, and no game client is read, hooked or
        modified.
      </p>

      <h2>Open source</h2>
      <p>
        Built with Next.js, React, PostgreSQL, Drizzle ORM, socket.io, pg-boss, Tailwind CSS, and{" "}
        <a href="https://tradingview.github.io/lightweight-charts/" rel="noopener">
          Lightweight Charts
        </a>{" "}
        from TradingView. Thanks to their maintainers.
      </p>

      <h2>Traders</h2>
      <p>
        And the prices that make this an exchange rather than a mirror of UEX come from the people
        who actually trade here. The tape is theirs.
      </p>
    </>
  );
}
