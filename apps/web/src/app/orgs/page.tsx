import { getDb, listMyOrgs, listOrgMembers, orgStanding, type OrgDto, type OrgMemberDto } from "@kcx/db";
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
  let standing: Awaited<ReturnType<typeof orgStanding>> | null = null;

  try {
    const db = getDb();
    orgs = await listMyOrgs(db, user.id);
    const selected = orgs.find((o) => o.id === id) ?? orgs[0];
    if (selected) {
      [members, standing] = await Promise.all([listOrgMembers(db, selected.id), orgStanding(db, selected.id)]);
    }
  } catch (err) {
    console.error("[orgs page]", err instanceof Error ? err.message : err);
  }

  return (
    <>
      <div className="mb-4">
        <h1 className="text-lg font-bold text-ink">Orgs</h1>
        <p className="text-xs text-ink-dim">
          Trade as a group: a shared declared treasury, members who can commit it up to a limit
          you set, and a settlement record that belongs to the org rather than to whoever
          happened to click. An org here has to be one your verified RSI profile says you
          actually belong to.
        </p>
      </div>

      <OrgConsole orgs={orgs} selectedId={id ?? null} members={members} standing={standing} />
    </>
  );
}
