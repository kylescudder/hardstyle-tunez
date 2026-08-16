import { createServer, type Server } from "node:http";

export interface HealthState {
  discordReady: boolean;
  lavalinkReady: boolean;
  startedAt: string;
}

export const startHealthServer = (port: number, state: HealthState): Server => {
  const server = createServer((request, response) => {
    if (request.url !== "/health") {
      response.writeHead(404).end();
      return;
    }
    const status = state.discordReady ? "ok" : "starting";
    response.writeHead(state.discordReady ? 200 : 503, {
      "content-type": "application/json",
    });
    response.end(
      JSON.stringify({
        status,
        discord: state.discordReady ? "connected" : "disconnected",
        lavalink: state.lavalinkReady ? "connected" : "degraded",
        startedAt: state.startedAt,
      }),
    );
  });
  server.listen(port, "0.0.0.0");
  return server;
};
