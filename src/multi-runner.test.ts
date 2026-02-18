import { describe, it, expect, vi, beforeEach } from 'vitest'
import { startMultiArchiver } from './multi-runner.js'
import type { ArchiverOptions, ArchiverResult, MultiArchiverConfig } from './types.js'

vi.mock('./archiver.js', () => ({
  startArchiver: vi.fn(),
}))

import { startArchiver } from './archiver.js'

const mockStartArchiver = vi.mocked(startArchiver)

function makeStopFn(): ArchiverResult['stop'] {
  return vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
}

function makeConfig(overrides?: Partial<MultiArchiverConfig>): MultiArchiverConfig {
  return {
    boards: [{ address: 'a.eth' }, { address: 'b.eth' }],
    ...overrides,
  }
}

describe('startMultiArchiver', () => {
  beforeEach(() => {
    mockStartArchiver.mockReset()
  })

  it('starts all boards and returns them in the archivers map', async () => {
    const stopA = makeStopFn()
    const stopB = makeStopFn()
    mockStartArchiver
      .mockResolvedValueOnce({ stop: stopA })
      .mockResolvedValueOnce({ stop: stopB })

    const result = await startMultiArchiver(makeConfig())

    expect(result.archivers.size).toBe(2)
    expect(result.archivers.has('a.eth')).toBe(true)
    expect(result.archivers.has('b.eth')).toBe(true)
    expect(result.errors.size).toBe(0)
  })

  it('passes correct options to startArchiver', async () => {
    mockStartArchiver.mockResolvedValue({ stop: makeStopFn() })

    const config = makeConfig({
      rpcUrl: 'ws://test:9138',
      stateDir: '/test/state',
      defaults: { perPage: 20 },
      boards: [{ address: 'x.eth', bumpLimit: 500 }],
    })

    await startMultiArchiver(config)

    const opts = mockStartArchiver.mock.calls[0][0] as ArchiverOptions
    expect(opts.subplebbitAddress).toBe('x.eth')
    expect(opts.plebbitRpcUrl).toBe('ws://test:9138')
    expect(opts.stateDir).toBe('/test/state')
    expect(opts.perPage).toBe(20)
    expect(opts.bumpLimit).toBe(500)
  })

  it('records failed boards in errors map and continues', async () => {
    mockStartArchiver
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce({ stop: makeStopFn() })

    const result = await startMultiArchiver(makeConfig())

    expect(result.archivers.size).toBe(1)
    expect(result.archivers.has('b.eth')).toBe(true)
    expect(result.errors.size).toBe(1)
    expect(result.errors.get('a.eth')?.message).toBe('connection refused')
  })

  it('throws AggregateError when ALL boards fail', async () => {
    mockStartArchiver.mockRejectedValue(new Error('fail'))

    await expect(startMultiArchiver(makeConfig())).rejects.toThrow(AggregateError)
  })

  it('AggregateError contains all individual errors', async () => {
    mockStartArchiver
      .mockRejectedValueOnce(new Error('fail-a'))
      .mockRejectedValueOnce(new Error('fail-b'))

    try {
      await startMultiArchiver(makeConfig())
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(AggregateError)
      const agg = err as AggregateError
      expect(agg.errors).toHaveLength(2)
      expect(agg.message).toContain('2 board(s) failed')
    }
  })

  it('starts boards sequentially (not in parallel)', async () => {
    const order: string[] = []

    mockStartArchiver.mockImplementation(async (opts: ArchiverOptions) => {
      order.push(opts.subplebbitAddress)
      return { stop: makeStopFn() }
    })

    await startMultiArchiver(makeConfig({
      boards: [{ address: 'first.eth' }, { address: 'second.eth' }, { address: 'third.eth' }],
    }))

    expect(order).toEqual(['first.eth', 'second.eth', 'third.eth'])
  })

  describe('stop()', () => {
    it('calls stop on all archivers', async () => {
      const stopA = makeStopFn()
      const stopB = makeStopFn()
      mockStartArchiver
        .mockResolvedValueOnce({ stop: stopA })
        .mockResolvedValueOnce({ stop: stopB })

      const result = await startMultiArchiver(makeConfig())
      await result.stop()

      expect(stopA).toHaveBeenCalledOnce()
      expect(stopB).toHaveBeenCalledOnce()
    })

    it('is resilient to individual stop failures', async () => {
      const stopA = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('cleanup fail'))
      const stopB = makeStopFn()
      mockStartArchiver
        .mockResolvedValueOnce({ stop: stopA })
        .mockResolvedValueOnce({ stop: stopB })

      const result = await startMultiArchiver(makeConfig())
      // Should not throw even though stopA fails
      await result.stop()

      expect(stopA).toHaveBeenCalledOnce()
      expect(stopB).toHaveBeenCalledOnce()
    })
  })

  it('wraps non-Error rejections in Error objects', async () => {
    mockStartArchiver
      .mockRejectedValueOnce('string error')
      .mockResolvedValueOnce({ stop: makeStopFn() })

    const result = await startMultiArchiver(makeConfig())

    expect(result.errors.get('a.eth')?.message).toBe('string error')
  })
})
