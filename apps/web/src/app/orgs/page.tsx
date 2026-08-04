import {
  getDb,
  listMyOrgs,
  listOrgMembers,
  listOrgProposals,
  orgStanding,
  type OrgDto,
  type OrgMemberDto,
  type OrgProposalDto,
} from "@kcx/db";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OrgConsole } from "@/components/org-console";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Orgs" };

/**
 * Org console.
 *
 * Orgs are the real economic units in Star Citizen — fleets buy together and mining crews
 * sell together — but until now KCX could only see individuals, so a nine-person operation
 * showed up as nine unrelated traders with no shared money and no shared record.
 */
export default async function OrgsPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/signin");
  const { id } = await searchParams;

  let orgs: OrgDto[] = [];
  let members: OrgMemberDto[] = [];
  let proposals: OrgProposalDto[] = [];
  let standing: Awaited<ReturnType<typeof orgStanding>> | null = null;

  try {
    const db = getDb();
    orgs = await listMyOrgs(db, user.id);
    const selected = orgs.find((o) => o.id === id) ?? orgs[0];
    if (selected) {
      [members, standing, proposals] = await Promise.all([
        listOrgMembers(db, selected.id),
        orgStanding(db, selected.id),
        listOrgProposals(db, selected.id, user.id),
      ]);
    }
  } catch (err) {
    console.error("[orgs page]", err instanceof Error ? err.message : err);
  }

  return (
    <>
      <div className="mb-4">
        <h1 className="text-lg font-bold text-ink">Orgs</h1>
        <p className="text-xs text-ink-dim">
          Orgs come from RSI, not from here: one appears when a verified trader's profile names
          it, and the roster is whoever currently names it. Before it can trade, someone who can
          edit the org's RSI charter has to prove they lead it — after that their word decides
          who holds what, and the board decides what gets bought.
        </p>
      </div>

      <OrgConsole
        orgs={orgs}
        selectedId={id ?? null}
        members={members}
        proposals={proposals}
        standing={standing}
      />
    </>
  );
}
