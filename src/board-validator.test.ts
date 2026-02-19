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
    mockConnect.mockResolvedValue(mockPlebbitInstance(['board.eth', 'other.eth'], mockDestroy))

    await expect(validateBoardAddress('board.eth', 'ws://localhost:9138')).resolves.toBeUndefined()
    expect(mockDestroy).toHaveBeenCalledOnce()
  })

  it('throws when address is not in subplebbits list', async () => {
    mockConnect.mockResolvedValue(mockPlebbitInstance(['other.eth', 'another.eth'], mockDestroy))

    await expect(validateBoardAddress('missing.eth', 'ws://localhost:9138'))
      .rejects.toThrow('Subplebbit "missing.eth" not found')
    expect(mockDestroy).toHaveBeenCalledOnce()
  })

  it('lists available subplebbits in error message', async () => {
    mockConnect.mockResolvedValue(mockPlebbitInstance(['a.eth', 'b.eth'], mockDestroy))

    await expect(validateBoardAddress('missing.eth', 'ws://localhost:9138'))
      .rejects.toThrow('Available subplebbits: a.eth, b.eth')
  })

  it('shows "no subplebbits available" when list is empty', async () => {
    mockConnect.mockResolvedValue(mockPlebbitInstance([], mockDestroy))

    await expect(validateBoardAddress('missing.eth', 'ws://localhost:9138'))
      .rejects.toThrow('No subplebbits available on this node')
  })

  it('includes RPC URL in error message', async () => {
    mockConnect.mockResolvedValue(mockPlebbitInstance([], mockDestroy))

    await expect(validateBoardAddress('x.eth', 'ws://custom:9138'))
      .rejects.toThrow('ws://custom:9138')
  })

  it('passes correct RPC URL to connectToPlebbitRpc', async () => {
    mockConnect.mockResolvedValue(mockPlebbitInstance(['board.eth'], mockDestroy))

    await validateBoardAddress('board.eth', 'ws://test:9138')

    expect(mockConnect).toHaveBeenCalledWith('ws://test:9138')
  })

  it('destroys plebbit instance even when validation fails', async () => {
    mockConnect.mockResolvedValue(mockPlebbitInstance([], mockDestroy))

    try {
      await validateBoardAddress('x.eth', 'ws://localhost:9138')
    } catch {
      // expected
    }
    expect(mockDestroy).toHaveBeenCalledOnce()
  })
})
