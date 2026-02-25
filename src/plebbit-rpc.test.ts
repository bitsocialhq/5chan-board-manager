import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import { connectToPlebbitRpc } from './plebbit-rpc.js'
import type { PlebbitInstance } from './types.js'

const require = createRequire(import.meta.url)
const { version } = require('../package.json') as { version: string }

vi.mock('@plebbit/plebbit-js', () => ({
  default: vi.fn(),
}))

import Plebbit from '@plebbit/plebbit-js'

const mockPlebbit = vi.mocked(Plebbit)

type Listener = (...args: unknown[]) => void

function createMockInstance() {
  const listeners: Record<string, Listener[]> = {}
  const instance = {
    subplebbits: [] as string[],
    on: vi.fn((event: string, cb: Listener) => {
      if (!listeners[event]) listeners[event] = []
      listeners[event].push(cb)
    }),
    once: vi.fn((event: string, cb: Listener) => {
      if (!listeners[event]) listeners[event] = []
      listeners[event].push(cb)
    }),
    destroy: vi.fn().mockResolvedValue(undefined),
  } as unknown as PlebbitInstance

  return { instance, listeners }
}

describe('connectToPlebbitRpc', () => {
  beforeEach(() => {
    mockPlebbit.mockReset()
  })

  it('waits for subplebbitschange before returning', async () => {
    const { instance, listeners } = createMockInstance()
    mockPlebbit.mockResolvedValue(instance)

    let resolved = false
    const promise = connectToPlebbitRpc('ws://localhost:9138').then((p) => {
      resolved = true
      return p
    })

    // Give microtasks a chance to run
    await new Promise((r) => setTimeout(r, 10))
    expect(resolved).toBe(false)

    // Fire the event
    for (const cb of listeners['subplebbitschange'] ?? []) cb()

    const result = await promise
    expect(resolved).toBe(true)
    expect(result).toBe(instance)
  })

  it('attaches an error handler', async () => {
    const { instance, listeners } = createMockInstance()
    // Resolve subplebbitschange immediately
    ;(instance.once as ReturnType<typeof vi.fn>).mockImplementation((_event: string, cb: Listener) => {
      cb()
    })
    mockPlebbit.mockResolvedValue(instance)

    await connectToPlebbitRpc('ws://localhost:9138')

    const errorHandlers = (listeners['error'] ?? [])
    expect(errorHandlers).toHaveLength(1)
  })

  it('passes correct RPC options to Plebbit constructor with default userAgent', async () => {
    const { instance } = createMockInstance()
    ;(instance.once as ReturnType<typeof vi.fn>).mockImplementation((_event: string, cb: Listener) => {
      cb()
    })
    mockPlebbit.mockResolvedValue(instance)

    await connectToPlebbitRpc('ws://custom:9138')

    expect(mockPlebbit).toHaveBeenCalledWith({
      plebbitRpcClientsOptions: ['ws://custom:9138'],
      userAgent: `5chan-board-manager:${version}`,
    })
  })

  it('passes custom userAgent when provided', async () => {
    const { instance } = createMockInstance()
    ;(instance.once as ReturnType<typeof vi.fn>).mockImplementation((_event: string, cb: Listener) => {
      cb()
    })
    mockPlebbit.mockResolvedValue(instance)

    await connectToPlebbitRpc('ws://custom:9138', 'my-custom-agent:1.0')

    expect(mockPlebbit).toHaveBeenCalledWith({
      plebbitRpcClientsOptions: ['ws://custom:9138'],
      userAgent: 'my-custom-agent:1.0',
    })
  })
})
