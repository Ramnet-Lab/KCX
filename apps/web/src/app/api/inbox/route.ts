import { deleteMessage, getDb, listInbox, markMessagesRead, unreadMessageCount } from "@kcx/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** GET — the trader's inbox, newest first, with the count the header badge shows. */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ messages: [], unread: 0 }, { status: 401 });
  try {
    const db = getDb();
    const [messages, unread] = await Promise.all([listInbox(db, user.id), unreadMessageCount(db, user.id)]);
    return NextResponse.json({ messages, unread });
  } catch (err) {
    console.error("[inbox:list]", err instanceof Error ? err.message : err);
    return NextResponse.json({ messages: [], unread: 0, error: "Unavailable" }, { status: 503 });
  }
}

const readRequest = z.object({ id: z.string().uuid().optional() });

/**
 * PATCH — mark one message read, or everything when no id is given.
 *
 * Per-message rather than the alert feed's mark-everything-at-once: these were written to
 * you by a person and answering one is not the same as having dealt with the rest.
 */
export async function PATCH(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const parsed = readRequest.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  try {
    const db = getDb();
    await markMessagesRead(db, user.id, parsed.data.id);
    return NextResponse.json({ ok: true, unread: await unreadMessageCount(db, user.id) });
  } catch (err) {
    console.error("[inbox:read]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

/** DELETE — clear a message from the inbox. The record survives; the recipient's view doesn't. */
export async function DELETE(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Which message?" }, { status: 400 });

  try {
    const db = getDb();
    const removed = await deleteMessage(db, user.id, id);
    if (!removed) return NextResponse.json({ error: "No such message" }, { status: 404 });
    return NextResponse.json({ ok: true, unread: await unreadMessageCount(db, user.id) });
  } catch (err) {
    console.error("[inbox:delete]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
