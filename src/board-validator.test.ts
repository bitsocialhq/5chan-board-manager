import { describe, it, expect, vi, beforeEach } from 'vitest'
import { validateBoardAddress } from './board-validator.js'
import type { PlebbitInstance } from './types.js'

vi.mock('./plebbit-rpc.js', () => ({
  connectToPlebbitRpc: vi.fn(),
}))

import { connectToPlebbitRpc } from './plebbit-rpc.js'

const mockConnect = vi.mocked(connectToPlebbitRpc)

function mockPlebbitInstance(subplebbits: string[], destroy: () => Promise<void>): PlebbitInstance {
  return { subplebbits, destroy } as unknown as PlebbitInstance
}

describe('validateBoardAddress', () => {
  const mockDestroy = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)

  beforeEach(() => {
    mockConnect.mockReset()
    mockDestroy.mockClear()
  })

  it('succeeds when address is in subplebbits list', async () => {
    mockConnect.mockResolvedValue(mockPlebbitInstance(['board.bso', 'other.bso'], mockDestroy))

    await expect(validateBoardAddress('board.bso', 'ws://localhost:9138')).resolves.toBeUndefined()
    expect(mockDestroy).toHaveBeenCalledOnce()
  })

  it('throws when address is not in subplebbits list', async () => {
    mockConnect.mockResolvedValue(mockPlebbitInstance(['other.bso', 'another.bso'], mockDestroy))

    await expect(validateBoardAddress('missing.bso', 'ws://localhost:9138'))
      .rejects.toThrow('Subplebbit "missing.bso" not found')
    expect(mockDestroy).toHaveBeenCalledOnce()
  })

  it('lists available subplebbits in error message', async () => {
    mockConnect.mockResolvedValue(mockPlebbitInstance(['a.bso', 'b.bso'], mockDestroy))

    await expect(validateBoardAddress('missing.bso', 'ws://localhost:9138'))
      .rejects.toThrow('Available subplebbits: a.bso, b.bso')
  })

  it('shows "no subplebbits available" when list is empty', async () => {
    mockConnect.mockResolvedValue(mockPlebbitInstance([], mockDestroy))

    await expect(validateBoardAddress('missing.bso', 'ws://localhost:9138'))
      .rejects.toThrow('No subplebbits available on this node')
  })

  it('includes RPC URL in error message', async () => {
    mockConnect.mockResolvedValue(mockPlebbitInstance([], mockDestroy))

    await expect(validateBoardAddress('x.bso', 'ws://custom:9138'))
      .rejects.toThrow('ws://custom:9138')
  })

  it('passes correct RPC URL to connectToPlebbitRpc', async () => {
    mockConnect.mockResolvedValue(mockPlebbitInstance(['board.bso'], mockDestroy))

    await validateBoardAddress('board.bso', 'ws://test:9138')

    expect(mockConnect).toHaveBeenCalledWith('ws://test:9138')
  })

  it('destroys plebbit instance even when validation fails', async () => {
    mockConnect.mockResolvedValue(mockPlebbitInstance([], mockDestroy))

    try {
      await validateBoardAddress('x.bso', 'ws://localhost:9138')
    } catch {
      // expected
    }
    expect(mockDestroy).toHaveBeenCalledOnce()
  })
})
