import { JsonRpcProvider } from "ethers";

const readMethods =
  /^(eth_call|eth_get\w+|eth_chainId|eth_blockNumber|eth_gasPrice|eth_maxPriorityFeePerGas|eth_estimateGas|net_version)$/;

// Conduit can report throttling inside an HTTP-200 JSON-RPC batch. Retry only
// explicit throttling of reads; never replay a transaction broadcast.
export class FaucetProvider extends JsonRpcProvider {
  async _send(payload) {
    const requests = Array.isArray(payload) ? payload : [payload];
    const responses = await super._send(payload);
    for (let i = 0; i < responses.length; i++) {
      const request = requests.find((item) => item.id === responses[i].id);
      if (!request || !readMethods.test(request.method)) continue;
      for (
        let attempt = 0;
        attempt < 4 && responses[i].error?.code === -32017;
        attempt++
      ) {
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * 2 ** attempt),
        );
        responses[i] = (await super._send(request))[0];
      }
    }
    return responses;
  }
}
