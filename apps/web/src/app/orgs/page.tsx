import {
  backfillOrgMembership,
  getDb,
  listBazaarListings,
  listContractsBoard,
  listMyOrgs,
  listOrgMembers,
  listOrgProposals,
  listPublicOrgs,
  orgStanding,
  type BazaarListingDto,
  type OrgDto,
  type OrgMemberDto,
  type OrgProposalDto,
  type OrgSummaryDto,
  type ServiceContractDto,
} from "@kcx/db";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OrgConsole } from "@/components/org-console";
import { refreshOrgPublicProfile } from "@/lib/org-verify";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "My org" };

/**
 * The org console.
 *
 * One page with tabs rather than several routes: an org is a single thing, and splitting
 * "your org", "what everyone else sees" and "other orgs" across three URLs made checking
 * your own public presentation a navigation exercise. The public tab renders the SAME
 * component the public route does, so the preview cannot drift from what counterparties
 * actually get.
 */
export default async function OrgsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; channel?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/signin");
  const { id, channel } = await searchParams;

  let orgs: OrgDto[] = [];
  let members: OrgMemberDto[] = [];
  let proposals: OrgProposalDto[] = [];
  let directory: OrgSummaryDto[] = [];
  let listings: BazaarListingDto[] = [];
  let contracts: ServiceContractDto[] = [];
  let standing: Awaited<ReturnType<typeof orgStanding>> | null = null;

  try {
    const db = getDb();
    // Accounts verified before orgs were derived have a main_org_sid and no membership row.
    // A no-op once it exists, so it costs one indexed read on every other visit.
    await backfillOrgMembership(db, user.id);
    orgs = await listMyOrgs(db, user.id);
    let selected = orgs.find((o) => o.id === id) ?? orgs[0];
    // Same lazy fill as the public page: only for the org actually being looked at, never
    // in a loop over the directory.
    if (selected) {
      await refreshOrgPublicProfile(selected.id, selected.sid).catch(() => {});
      orgs = await listMyOrgs(db, user.id);
      selected = orgs.find((o) => o.id === id) ?? orgs[0];
    }

    directory = await listPublicOrgs(db, {});
    if (selected) {
      [members, standing, proposals, listings, contracts] = await Promise.all([
        listOrgMembers(db, selected.id),
        orgStanding(db, selected.id),
        listOrgProposals(db, selected.id, user.id),
        listBazaarListings(db, { viewerId: user.id, limit: 200 }).then((all) =>
          all.filter((l) => l.orgId === selected.id),
        ),
        listContractsBoard(db, { viewerId: user.id }).then((all) => all.filter((c) => c.orgId === selected.id)),
      ]);
    }
  } catch (err) {
    console.error("[orgs page]", err instanceof Error ? err.message : err);
  }

  const selected = orgs.find((o) => o.id === id) ?? orgs[0] ?? null;

  return (
    <>
      <div className="mb-4">
        <h1 className="text-lg font-bold text-ink">My org</h1>
        <p className="text-xs text-ink-dim">
          Orgs come from RSI, not from here: one appears when a verified trader&apos;s profile names
          it, and the roster is whoever currently names it. Before it can trade, someone who can
          edit the org&apos;s RSI charter has to prove they lead it — after that their word decides
          who holds what, and the board decides what gets bought.
        </p>
      </div>

      <OrgConsole
        orgs={orgs}
        selectedId={id ?? null}
        openChannelId={channel ?? null}
        members={members}
        proposals={proposals}
        standing={standing}
        publicData={selected ? { org: selected, standing, listings, contracts } : null}
        directory={directory}
      />
    </>
  );
}
