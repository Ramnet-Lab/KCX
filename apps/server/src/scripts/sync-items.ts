/** Manually seed or refresh the bazaar item catalogue (also scheduled daily at 04:00). */
import { loadRootEnv } from "../env";
loadRootEnv();

import { closeDb } from "@kcx/db";
import { pruneUnusedPlayerItems, recountItemListings, syncItemCatalogue } from "../jobs/sync-items";

await syncItemCatalogue();
console.log(`re-ranked:  ${await recountItemListings()}`);
console.log(`pruned:     ${await pruneUnusedPlayerItems()}`);
await closeDb();
process.exit(0);
