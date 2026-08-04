import { createServer, type Server as HttpServer } from "node:http";
import {
  WS_PATH,
  WS_ROOMS,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type TickerUpdate,
} from "@kcx/shared";
import { Server } from "socket.io";

export type Ws = {
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  http: HttpServer;
  broadcastTicker: (payload: TickerUpdate) => void;
  close: () => Promise<void>;
};

/**
 * Standalone socket.io server (own HTTP listener — never a Next.js custom server;
 * prod routes /ws here via Caddy). M3 scope: the public ticker room. Presence and
 * user rooms arrive in M5.
 */
export function createWsServer(port: number, corsOrigins: string[]): Ws {
  const http = createServer((_req, res) => {
    // Plain-HTTP probe endpoint for Caddy/uptime checks.
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("kcx-ws ok");
  });

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(http, {
    cors: { origin: corsOrigins },
    serveClient: false,
    // One path in every environment, so no proxy has to rewrite anything: Caddy, a
    // Cloudflare Tunnel, or a direct connection to :4000 all forward it unchanged.
    path: WS_PATH,
  });

  io.on("connection", (socket) => {
    void socket.join(WS_ROOMS.ticker);
    void socket.join(WS_ROOMS.market);
    // Clients opt into their personal feed so contract activity reaches them anywhere.
    socket.on("identify", (userId: string) => {
      if (typeof userId === "string" && /^[0-9a-f-]{36}$/i.test(userId)) {
        void socket.join(WS_ROOMS.user(userId));
      }
    });
  });

  http.listen(port, () => console.log(`[ws] socket.io listening on :${port}`));

  return {
    io,
    http,
    broadcastTicker: (payload) => {
      io.to(WS_ROOMS.ticker).emit("ticker:update", payload);
    },
    close: async () => {
      await io.close();
    },
  };
}
