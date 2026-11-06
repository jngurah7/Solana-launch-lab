const DEVNET_RPC_URL = 'https://api.devnet.solana.com';
const LAMPORTS_PER_SOL = 1_000_000_000;

interface RpcEnvelope<T> {
  result?: T;
  error?: {
    code: number;
    message: string;
  };
}

let rpcRequestId = 0;

async function callDevnetRpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(DEVNET_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++rpcRequestId,
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`Solana Devnet responded with HTTP ${response.status}. Please try again.`);
  }

  const payload = (await response.json()) as RpcEnvelope<T>;
  if (payload.error) {
    throw new Error(payload.error.message || 'The Devnet request failed.');
  }
  if (!Object.prototype.hasOwnProperty.call(payload, 'result')) {
    throw new Error('Solana Devnet returned an empty response.');
  }

  return payload.result as T;
}

export async function getDevnetBalance(address: string): Promise<number> {
  const result = await callDevnetRpc<{ value: number }>('getBalance', [
    address,
    { commitment: 'confirmed' },
  ]);

  if (!Number.isFinite(result.value) || result.value < 0) {
    throw new Error('Solana Devnet returned an invalid balance.');
  }

  return result.value / LAMPORTS_PER_SOL;
}
