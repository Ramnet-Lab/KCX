/** Manually run the escrow/fill-by sweep (also scheduled every 5 min in main.ts). */
import { loadRootEnv } from "../env";
loadRootEnv();

import { closeDb, expireStaleContracts, expireUnfilledOrders, getDb, reconcileReservations } from "@kcx/db";

const db = getDb();
console.log(`escrows expired:      ${await expireStaleContracts(db)}`);
console.log(`reservations healed:  ${await reconcileReservations(db)}`);
console.log(`orders expired:       ${await expireUnfilledOrders(db)}`);
await closeDb();
process.exit(0);
