import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminConsole } from "@/components/admin-console";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Moderation",
  robots: { index: false, follow: false },
};

/**
 * Moderator console.
 *
 * 404 rather than a "forbidden" page for everyone else: whether this route exists is not
 * something a stranger needs confirmed. Every API it calls re-checks the role, so this
 * gate is the courtesy, not the security.
 */
export default async function AdminPage() {
  const user = await currentUser();
  if (!user || (user.role !== "mod" && user.role !== "admin")) notFound();

  const isAdmin = user.role === "admin";

  return (
    <>
      <div className="mb-4">
        <h1 className="text-lg font-bold text-ink">{isAdmin ? "Admin" : "Moderation"}</h1>
        <p className="text-xs text-ink-dim">
          Signed in as <span className="text-ink">{user.displayName}</span> ({user.role}). Every
          action here is written to an append-only log with your name on it.
        </p>
        {/*
          Said plainly on the page rather than left to be discovered by a button not being
          there. A moderator who believes they are an admin files the bug against us.
        */}
        {!isAdmin && (
          <p className="mt-1 text-[11px] text-ink-faint">
            Moderator tools: reports, bans, contract breaches and the idea queue. Standing in as
            another trader, and running an org&apos;s own controls, are the admin&apos;s alone.
          </p>
        )}
      </div>
      <AdminConsole isAdmin={isAdmin} />
    </>
  );
}
