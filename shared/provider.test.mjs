import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { FaucetProvider } from "./provider.mjs";

test("retries throttled reads in a mixed batch without replaying broadcasts", async () => {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    const respond = (item) => {
      calls.push(item.method);
      if (
        item.method === "eth_call" &&
        calls.filter((m) => m === "eth_call").length > 1
      )
        return { jsonrpc: "2.0", id: item.id, result: "0x01" };
      return {
        jsonrpc: "2.0",
        id: item.id,
        error: { code: -32017, message: "Rate Limit Exceeded" },
      };
    };
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify(
        Array.isArray(payload) ? payload.map(respond) : respond(payload),
      ),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const provider = new FaucetProvider(
    `http://127.0.0.1:${server.address().port}`,
  );
  try {
    const result = await provider._send([
      { jsonrpc: "2.0", id: 1, method: "eth_call", params: [] },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "eth_sendRawTransaction",
        params: ["0x"],
      },
    ]);
    assert.equal(result[0].result, "0x01");
    assert.equal(result[1].error.code, -32017);
    assert.deepEqual(calls, ["eth_call", "eth_sendRawTransaction", "eth_call"]);
  } finally {
    provider.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
});
