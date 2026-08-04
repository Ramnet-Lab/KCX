import type { Metadata } from "next";
import Link from "next/link";
import { SignInFlow } from "@/components/sign-in-flow";
import { AccountActions } from "@/components/account-actions";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Verify your RSI handle to trade on the Kestrel Commodities Exchange.",
};

export default async function SignInPage() {
  const user = await currentUser();

  // Deliberately NOT redirecting a signed-in user away. Bouncing them to /account made this
  // page unreachable, so anyone signed in under the wrong handle had no route to switch.
  return (
    <>
      {user && (
        <div className="mx-auto mb-4 max-w-md rounded border border-line bg-panel p-3 text-xs">
          <p className="text-ink-dim">
            You&apos;re already signed in as <span className="text-ink">{user.displayName}</span>
            {user.rsiVerifiedAt == null && <span className="text-ink-faint"> (unverified test account)</span>}.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Link href="/account" className="text-accent hover:underline">
              Go to my account
            </Link>
            <AccountActions />
          </div>
          <p className="mt-2 text-ink-faint">
            Signing in below with a different handle will replace this session.
          </p>
        </div>
      )}
      <SignInFlow />
    </>
  );
}
