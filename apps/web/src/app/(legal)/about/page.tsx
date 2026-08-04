import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About",
  description:
    "What the Kestrel Commodities Exchange is, who runs it, and the limits of what it can promise.",
};

export default function AboutPage() {
  return (
    <>
      <h1 className="text-lg font-bold text-ink">About KCX</h1>

      <p>
        The Kestrel Commodities Exchange is a player-driven commodities market for Star Citizen:
        a price terminal fused with an order board and a contract market. It is a fan project,
        run by one person, and it is free.
      </p>

      <h2>What it does</h2>
      <p>
        It tracks what commodities are worth. NPC terminal prices come from the community UEX
        dataset every 30 minutes and seed the board. From a commodity&apos;s first settled player
        trade onward, its headline price — the <strong>mark</strong> — is set by players, and the
        terminal price becomes context on the chart rather than the number.
      </p>
      <p>
        The reasoning behind that, and every rule governing which trades count, is written up in
        the market model document in the repository. If a price moves and you want to know why,
        the <Link href="/commodities">tape on each commodity page</Link> lists every settled
        trade behind it — including the ones that were refused, and the reason.
      </p>

      <h2>What it is not</h2>
      <p>
        <strong>KCX never holds your aUEC or your cargo.</strong> There is no escrow of value
        here and there cannot be: Star Citizen has no API that would let a third party take
        custody of anything, and no way for us to verify what you own. Every trade arranged here
        settles between two players, in-game, bilaterally.
      </p>
      <p>
        That has a consequence worth stating plainly rather than burying. Balances and holdings
        on this site are <strong>self-declared</strong>. When the exchange says a trade is
        collateralised, it is checking a number the trader typed. The safeguards on this site
        make manipulation expensive and visible; they do not make it impossible, and they cannot
        make a counterparty honest. Trade with people, not with a website.
      </p>

      <h2>Non-commercial</h2>
      <p>
        There is no advertising, no donation link, no paid tier, and no plan for any of them.
        Roberts Space Industries permits fan projects on the condition that they are
        non-commercial, and that condition is one KCX intends to keep rather than test.
      </p>
      <p>
        Real-money trading is banned outright — buying or selling aUEC, accounts, or items for
        actual currency. Accounts found doing it are removed permanently, and so is every trade
        they printed.
      </p>

      <h2>Who runs it</h2>
      <p>
        KCX is built and operated by <strong>ramnet</strong>. Moderation decisions, the rules
        below, and any mistakes are mine.
      </p>

      <h2>Contact</h2>
      <p>
        For rule questions, disputes, data corrections, or anything from Cloud Imperium: the
        contact address is published in the site repository. Takedown or modification requests
        from CIG are honoured first and argued about afterwards, if at all.
      </p>

      <h2>Read next</h2>
      <ul>
        <li>
          <Link href="/terms">Terms of use</Link> — what you agree to by trading here
        </li>
        <li>
          <Link href="/privacy">Privacy</Link> — what is stored and what is not
        </li>
        <li>
          <Link href="/credits">Credits</Link> — whose data this is built on
        </li>
      </ul>
    </>
  );
}
