import Plebbit from '@plebbit/plebbit-js'
import { createRequire } from 'node:module'
import type { PlebbitInstance } from './types.js'

const require = createRequire(import.meta.url)
const { version } = require('../package.json') as { version: string }

/**
 * Connect to a Plebbit RPC node and wait for the subplebbits list to be populated.
 *
 * After `await Plebbit(...)` the RPC connection is open but `plebbit.subplebbits`
 * is still empty. The RPC pushes the list asynchronously, firing the
 * `subplebbitschange` event once it arrives. This helper waits for that event
 * before returning — matching the pattern used by bitsocial-cli.
 */
export async function connectToPlebbitRpc(rpcUrl: string, userAgent?: string): Promise<PlebbitInstance> {
  const plebbit = await Plebbit({
    plebbitRpcClientsOptions: [rpcUrl],
    userAgent: userAgent ?? `5chan-board-manager:${version}`,
  })
  plebbit.on('error', (err: Error) => {
    console.error('Plebbit RPC error:', err.message)
  })
  await new Promise<string[]>((resolve) => plebbit.once('subplebbitschange', resolve))
  return plebbit
}
