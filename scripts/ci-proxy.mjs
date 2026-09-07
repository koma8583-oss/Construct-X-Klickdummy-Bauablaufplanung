import http from "node:http";

const port = Number(process.env.CI_PROXY_PORT ?? 4173);
const routes = [
  { prefix: "/api", port: 8080 },
  { prefix: "/auth-service", port: 8080 },
  { prefix: "/internal", port: 8080 },
  { prefix: "/an/", port: 5174 },
  { prefix: "/hub/", port: 5175 },
];

function targetPort(pathname) {
  return (
    routes.find(
      (route) => pathname === route.prefix || pathname.startsWith(route.prefix),
    )?.port ?? 5173
  );
}

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", "http://ci-proxy").pathname;
  const upstreamPort = targetPort(pathname);
  const headers = { ...request.headers, host: `127.0.0.1:${upstreamPort}` };
  const upstream = http.request(
    {
      hostname: "127.0.0.1",
      port: upstreamPort,
      method: request.method,
      path: request.url,
      headers,
    },
    (upstreamResponse) => {
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        upstreamResponse.headers,
      );
      upstreamResponse.pipe(response);
    },
  );

  upstream.on("error", (error) => {
    if (!response.headersSent)
      response.writeHead(502, { "content-type": "text/plain" });
    response.end(`CI proxy upstream error: ${error.message}`);
  });
  request.pipe(upstream);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`CI proxy listening on http://127.0.0.1:${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
