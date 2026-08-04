import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What the Kestrel Commodities Exchange stores, why, and for how long.",
};

export default function PrivacyPage() {
  return (
    <>
      <h1 className="text-lg font-bold text-ink">Privacy</h1>
      <p className="text-ink-faint">
        The short version: this site collects a game handle and the trades you make with it. No
        email address, no analytics, no third-party trackers, no advertising.
      </p>

      <h2>What is stored</h2>
      <ul>
        <li>
          <strong>Your RSI handle</strong> and display name. This is public — it appears on your
          listings, contracts and on the trade tape.
        </li>
        <li>
          <strong>Authentication material.</strong> Passkey public keys, or a password hash if you
          set one. Passwords are hashed with scrypt and are not recoverable, by us or anyone else.
        </li>
        <li>
          <strong>Your declared position</strong> — the aUEC balance and cargo you type in. Private
          to you; used to check that your listings are backed.
        </li>
        <li>
          <strong>Your trading record</strong> — orders, contracts, bids, settled trades, ratings
          and moderation actions.
        </li>
        <li>
          <strong>Uploaded images</strong> attached to contracts. EXIF and GPS metadata are
          stripped on upload; an image that cannot be parsed and cleaned is refused rather than
          stored.
        </li>
        <li>
          <strong>A salted hash of your IP</strong> against sign-in events, for abuse
          investigation. The address itself is not retained in a readable form.
        </li>
      </ul>

      <h2>What is not stored</h2>
      <p>
        No email address is requested or held. No analytics or telemetry service runs on this site.
        No advertising or social network scripts are loaded. The only cookie is a first-party
        session token — there is no tracking cookie, and therefore no cookie banner to click.
      </p>
      <p>
        Your RSI profile is fetched only when you personally start a verification, and only to
        read the code you placed in your own bio.
      </p>

      <h2>What other people can see</h2>
      <p>
        Public: your handle, your active listings and contracts, your settled trades on the tape,
        your rating and completion record. Private: your declared balance and holdings, your
        authentication material, your sign-in history, and the content of classified contracts
        before you accept one.
      </p>

      <h2>How long it is kept</h2>
      <p>
        Sign-in events and IP hashes are pruned periodically. Sessions expire. Everything else is
        kept while the account exists, because a trading record with gaps is not a trading record.
      </p>

      <h2>Deleting your account</h2>
      <p>
        Ask, and the account and its personal data are removed: handle, display name,
        authentication material, declared position, sign-in history.
      </p>
      <p>
        <strong>Settled trades are not deleted.</strong> They are anonymised — detached from your
        identity and retained as price history. This is deliberate: a published market price whose
        underlying trades can be withdrawn afterwards is not a market price, and anyone who traded
        against it would have been reading a number that could later be edited. What is removed is
        the link between those trades and you.
      </p>

      <h2>Where it lives</h2>
      <p>
        On a single self-hosted server, in one PostgreSQL database, with nightly local backups.
        Traffic is proxied through Cloudflare, which sees request metadata as any CDN does. No
        data is sold, shared, or handed to third parties for any purpose.
      </p>

      <h2>Age</h2>
      <p>This site is not intended for anyone under 16.</p>

      <h2>Changes</h2>
      <p>
        If what is collected changes, this page changes with it, and material changes are announced
        on the site rather than made quietly.
      </p>
    </>
  );
}
