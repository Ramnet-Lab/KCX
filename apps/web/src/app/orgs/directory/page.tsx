import { getDb, listPublicOrgs, type OrgSummaryDto } from "@kcx/db";
import type { Metadata } from "next";
import Link from "next/link";
import { OrgDirectory } from "@/components/org-directory";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Orgs",
  description:
    "Star Citizen orgs trading on KCX — who is verified, what they have on the board, and whether they settle.",
};

export default async function OrgDirectoryPage() {
  let orgs: OrgSummaryDto[] = [];
  try {
    orgs = await listPublicOrgs(getDb(), {});
  } catch (err) {
    console.error("[org directory]", err instanceof Error ? err.message : err);
  }

  return (
    <>
      <div className="mb-4">
        <h1 className="text-lg font-bold text-ink">Orgs</h1>
        <p className="text-xs text-ink-dim">
          Every org with someone on KCX. They appear automatically from members&apos; RSI profiles —
          nothing here is registered by hand. A <span className="text-up">verified</span> org has
          had someone prove control of its RSI charter, which is what lets it hold a treasury and
          trade in its own name.{" "}
          <Link href="/orgs" className="text-accent hover:underline">
            Your own org
          </Link>
          .
        </p>
      </div>

      <OrgDirectory initial={orgs} />
    </>
  );
}
