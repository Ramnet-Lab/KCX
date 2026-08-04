import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of use",
  description: "The rules for trading on the Kestrel Commodities Exchange.",
};

export default function TermsPage() {
  return (
    <>
      <h1 className="text-lg font-bold text-ink">Terms of use</h1>
      <p className="text-ink-faint">Plain language, because rules nobody reads govern nobody.</p>

      <h2>1. In-game currency only</h2>
      <p>
        Everything quoted here is aUEC and in-game cargo. <strong>Real-money trading is banned</strong>
        — selling aUEC, cargo, accounts, or services for actual currency, cryptocurrency, gift
        cards, or goods. This is the one rule with no warning step: RMT is a permanent ban, all
        associated accounts, and every print those accounts produced is expunged and the affected
        marks recomputed.
      </p>

      <h2>2. KCX holds nothing</h2>
      <p>
        The exchange takes no custody of aUEC or cargo at any point. It cannot: the game exposes
        no interface that would allow it. Listings, contracts, bids and escrow states here are{" "}
        <strong>records of intent</strong>. Value moves between two players, in-game, or it does
        not move at all.
      </p>
      <p>
        Balances and holdings are self-declared and unverifiable. A green &quot;collateralised&quot;
        badge means the trader&apos;s own declared position covers their promise — not that anyone
        has confirmed it exists.
      </p>

      <h2>3. You trade at your own risk</h2>
      <p>
        KCX is not a party to your trade, does not guarantee delivery or payment, and cannot
        reverse anything. Reputation, the counterparty record, and the public tape exist to help
        you judge who you are dealing with. They are evidence, not insurance.
      </p>

      <h2>4. Market conduct</h2>
      <p>Trades that do not represent a genuine exchange between two parties are prohibited:</p>
      <ul>
        <li>
          <strong>Wash trading</strong> — trading with yourself through additional accounts, or
          with a partner, to manufacture a price or volume.
        </li>
        <li>
          <strong>Tape painting</strong> — settling trades chosen to move a published mark rather
          than to exchange goods.
        </li>
        <li>
          <strong>Coordinated pricing</strong> — arranging with others to set a mark.
        </li>
      </ul>
      <p>
        The exchange applies automated checks and will withhold a trade from the mark without
        warning or appeal: prices far outside the reference band, repeated trades between the same
        two accounts, and any single account dominating a commodity&apos;s recent volume.{" "}
        <strong>Withheld trades still settle and remain publicly visible with their reason</strong>
        {" "}— nothing is quietly deleted. Deliberate manipulation escalates to a ban.
      </p>

      <h2>5. What is not offered here</h2>
      <p>
        No banking, lending, interest, deposits, insurance, shares, funds, or investment schemes
        organised through this site. No gambling. Contracts are for work and goods, not for
        financial products. These are prohibited regardless of whether they are denominated in
        aUEC.
      </p>

      <h2>6. Accounts and identity</h2>
      <p>
        An account is bound to a verified RSI handle, proven by placing a code in your RSI profile
        bio. One account per person. Do not impersonate another handle or organisation. Your RSI
        handle is your durable identity here and survives game wipes; your trade record and
        reputation are attached to it.
      </p>

      <h2>7. Content you post</h2>
      <p>
        Contract text, notes and images must relate to in-game activity. No real-world personal
        information about anyone, no harassment, no sexual content, no content that is illegal
        where the servers run. Uploaded images have their metadata stripped, but do not upload
        anything you would not put on a public forum — contract images are visible to other
        players.
      </p>

      <h2>8. Moderation and appeals</h2>
      <p>
        Moderators may withhold prints, void contracts, suspend posting, and ban accounts for
        24 hours, 7 days, or permanently. Every action is recorded in an audit log. If you believe
        a decision was wrong, contact us within 14 days; a different moderator reviews where one
        is available, and the outcome is upheld or reversed with a reason.
      </p>
      <p>
        There is no public list of banned traders. Ban decisions are not published, and neither
        are accusations.
      </p>

      <h2>9. Availability</h2>
      <p>
        This is a hobby project on a single machine. It may be slow, wrong, or offline. Price data
        is community-crowdsourced and can lag the live game or be inaccurate. Nothing here is a
        guarantee of anything, and no service level is offered or implied.
      </p>

      <h2>10. Cloud Imperium</h2>
      <p>
        KCX is unofficial and unaffiliated. If Cloud Imperium asks for a change or for the site to
        stop, that is what happens — no argument, no delay. See <Link href="/about">About</Link>.
      </p>

      <h2>11. Changes</h2>
      <p>
        These terms will change as the exchange does. Material changes are announced on the site.
        Continuing to trade here means accepting the current version.
      </p>
    </>
  );
}
