import http from "node:http";
import { readFileSync } from "node:fs";
import { JsonRpcProvider, Wallet } from "ethers";
import { createService } from "./service.mjs";

const config = JSON.parse(
  readFileSync(process.env.TRIVIA_CONFIG || "server/config.json", "utf8"),
);
if (!process.env.FAUCET_ADMIN_PRIVATE_KEY)
  throw new Error("FAUCET_ADMIN_PRIVATE_KEY is required on the server");
const provider = new JsonRpcProvider(config.rpcUrl);
const signer = new Wallet(process.env.FAUCET_ADMIN_PRIVATE_KEY, provider);
const service = createService({ provider, signer, config });
await service.preflight();
const origins = new Set(config.allowedOrigins);
let inflightSubmissions = 0;
http
  .createServer(async (req, res) => {
    const origin = req.headers.origin;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Vary", "Origin");
    if (origin && !origins.has(origin)) {
      res.writeHead(403);
      res.end('{"error":"Origin not allowed"}');
      return;
    }
    if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    let admitted = false;
    try {
      const pathname = new URL(req.url, "http://localhost").pathname;
      let result;
      if (req.method === "GET" && pathname.startsWith("/api/admission/"))
        result = await service.admission(
          decodeURIComponent(pathname.slice("/api/admission/".length)),
        );
      else if (req.method === "GET" && pathname.startsWith("/api/requests/"))
        result = await service.request(pathname.slice("/api/requests/".length));
      else if (req.method === "POST" && pathname === "/api/trivia") {
        if (!String(req.headers["content-type"]).startsWith("application/json"))
          throw new Error("JSON required");
        if (inflightSubmissions >= 50)
          throw new Error("Submission service busy");
        admitted = true;
        inflightSubmissions++;
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 16384)
            throw new Error("Request too large");
        }
        result = await service.submit(JSON.parse(body));
      } else {
        res.writeHead(404);
        res.end('{"error":"Not found"}');
        return;
      }
      res.end(JSON.stringify(result));
    } catch (error) {
      // Log no key, calldata, or raw RPC object; provider errors may include inputs.
      const message = error.shortMessage || error.message || "Request failed";
      res.writeHead(400);
      res.end(JSON.stringify({ error: message }));
    } finally {
      if (admitted) inflightSubmissions--;
    }
  })
  .listen(
    Number(process.env.PORT || 8787),
    process.env.HOST || "127.0.0.1",
    () => console.log("Trivia API ready"),
  );
