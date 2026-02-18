import Plebbit from '@plebbit/plebbit-js'

/**
 * Validate that a board address exists in the plebbit node's subplebbits list.
 * Throws a descriptive error if the address is not found.
 */
export async function validateBoardAddress(address: string, rpcUrl: string): Promise<void> {
  const plebbit = await Plebbit({ plebbitRpcClientsOptions: [rpcUrl] })
  try {
    if (!plebbit.subplebbits.includes(address)) {
      const available = plebbit.subplebbits.length > 0
        ? `Available subplebbits: ${plebbit.subplebbits.join(', ')}`
        : 'No subplebbits available on this node'
      throw new Error(
        `Subplebbit "${address}" not found on RPC node at ${rpcUrl}. ${available}`,
      )
    }
  } finally {
    await plebbit.destroy()
  }
}
