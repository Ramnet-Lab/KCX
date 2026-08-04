import {
  getDb,
  getOrgBySid,
  listBazaarListings,
  listContractsBoard,
  orgStanding,
  type BazaarListingDto,
  type ServiceContractDto,
} from "@kcx/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrgContactButton } from "@/components/org-contact";
import { refreshOrgPublicProfile } from "@/lib/org-verify";
import { OrgPublicProfile } from "@/components/org-public-profile";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ sid: string }> }): Promise<Metadata> {
  const { sid } = await params;
  try {
    const org = await getOrgBySid(getDb(), sid);
    if (!org) return { title: "Org" };
    return {
      title: `${org.name} (${org.sid})`,
      description: `${org.name} on KCX — settled trades, live listings and contracts for this Star Citizen org.`,
    };
  } catch {
    return { title: "Org" };
  }
}

/**
 * An org's public page.
 *
 * Carries what a counterparty needs before dealing with them and nothing else: whether the
 * org proved its leadership, what it has settled, and what it currently has on the board.
 * The treasury and roster stay members-only — the redaction happens in `getOrgBySid`, not
 * in the component, so there is no fuller object sitting in a payload for the UI to be
 * trusted not to render.
 *
 * The same component renders the "Public view" tab inside an org's own console, so a
 * president previewing this is looking at exactly what everyone else gets.
 */
export default async function OrgPage({ params }: { params: Promise<{ sid: string }> }) {
  const { sid } = await params;
  const user = await currentUser();

  const db = getDb();
  let org = await getOrgBySid(db, sid, user?.id ?? null).catch(() => null);
  if (!org) notFound();

  // Fill in the name and logo from the org's public RSI page if we haven't yet. Throttled
  // to once a day per org, so a page view is at most one outbound request.
  await refreshOrgPublicProfile(org.id, org.sid).catch(() => {});
  org = (await getOrgBySid(db, sid, user?.id ?? null).catch(() => null)) ?? org;

  let listings: BazaarListingDto[] = [];
  let contracts: ServiceContractDto[] = [];
  let standing: Awaited<ReturnType<typeof orgStanding>> | null = null;
  try {
    [standing, listings, contracts] = await Promise.all([
      orgStanding(db, org.id),
      listBazaarListings(db, { viewerId: user?.id ?? null, limit: 200 }).then((all) =>
        all.filter((l) => l.orgId === org.id),
      ),
      listContractsBoard(db, { viewerId: user?.id ?? null }).then((all) => all.filter((c) => c.orgId === org.id)),
    ]);
  } catch (err) {
    console.error("[org page]", err instanceof Error ? err.message : err);
  }

  return (
    <OrgPublicProfile
      data={{ org, standing, listings, contracts }}
      contactSlot={
        <OrgContactButton targetOrgId={org.id} targetSid={org.sid} verified={org.status === "verified"} />
      }
    />
  );
}
