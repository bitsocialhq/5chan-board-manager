import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { startArchiverManager } from './archiver-manager.js'
import type { ArchiverOptions, ArchiverResult, MultiArchiverConfig } from './types.js'

vi.mock('./archiver.js', () => ({
  startArchiver: vi.fn(),
}))

import { startArchiver } from './archiver.js'

const mockStartArchiver = vi.mocked(startArchiver)

function makeStopFn(): ArchiverResult['stop'] {
  return vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
}

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'archiver-manager-test-'))
}

describe('startArchiverManager', () => {
  const dirs: string[] = []

  function tmpDir(): string {
    const d = makeTmpDir()
    dirs.push(d)
    return d
  }

  beforeEach(() => {
    mockStartArchiver.mockReset()
  })

  afterEach(async () => {
    for (const d of dirs) {
      rmSync(d, { recursive: true, force: true })
    }
    dirs.length = 0
  })

  it('starts archivers for all boards in initial config', async () => {
    const stopA = makeStopFn()
    const stopB = makeStopFn()
    mockStartArchiver
      .mockResolvedValueOnce({ stop: stopA })
      .mockResolvedValueOnce({ stop: stopB })

    const dir = tmpDir()
    const configPath = join(dir, 'config.json')
    const config: MultiArchiverConfig = {
      boards: [{ address: 'a.eth' }, { address: 'b.eth' }],
    }
    writeFileSync(configPath, JSON.stringify(config))

    const manager = await startArchiverManager(configPath, config)

    expect(manager.archivers.size).toBe(2)
    expect(manager.archivers.has('a.eth')).toBe(true)
    expect(manager.archivers.has('b.eth')).toBe(true)
    expect(manager.errors.size).toBe(0)

    await manager.stop()
  })

  it('records failed boards in errors map and continues', async () => {
    mockStartArchiver
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce({ stop: makeStopFn() })

    const dir = tmpDir()
    const configPath = join(dir, 'config.json')
    const config: MultiArchiverConfig = {
      boards: [{ address: 'a.eth' }, { address: 'b.eth' }],
    }
    writeFileSync(configPath, JSON.stringify(config))

    const manager = await startArchiverManager(configPath, config)

    expect(manager.archivers.size).toBe(1)
    expect(manager.archivers.has('b.eth')).toBe(true)
    expect(manager.errors.size).toBe(1)
    expect(manager.errors.get('a.eth')?.message).toBe('connection refused')

    await manager.stop()
  })

  it('starts with empty config', async () => {
    const dir = tmpDir()
    const configPath = join(dir, 'config.json')
    const config: MultiArchiverConfig = { boards: [] }
    writeFileSync(configPath, JSON.stringify(config))

    const manager = await startArchiverManager(configPath, config)

    expect(manager.archivers.size).toBe(0)
    expect(manager.errors.size).toBe(0)

    await manager.stop()
  })

  it('passes correct options to startArchiver', async () => {
    mockStartArchiver.mockResolvedValue({ stop: makeStopFn() })

    const dir = tmpDir()
    const configPath = join(dir, 'config.json')
    const config: MultiArchiverConfig = {
      rpcUrl: 'ws://test:9138',
      stateDir: '/test/state',
      defaults: { perPage: 20 },
      boards: [{ address: 'x.eth', bumpLimit: 500 }],
    }
    writeFileSync(configPath, JSON.stringify(config))

    const manager = await startArchiverManager(configPath, config)

    const opts = mockStartArchiver.mock.calls[0][0] as ArchiverOptions
    expect(opts.subplebbitAddress).toBe('x.eth')
    expect(opts.plebbitRpcUrl).toBe('ws://test:9138')
    expect(opts.stateDir).toBe('/test/state')
    expect(opts.perPage).toBe(20)
    expect(opts.bumpLimit).toBe(500)

    await manager.stop()
  })

  describe('hot-reload', () => {
    it('starts new archivers when boards are added to config', async () => {
      const stopA = makeStopFn()
      const stopNew = makeStopFn()
      mockStartArchiver
        .mockResolvedValueOnce({ stop: stopA })
        .mockResolvedValueOnce({ stop: stopNew })

      const dir = tmpDir()
      const configPath = join(dir, 'config.json')
      const config: MultiArchiverConfig = {
        boards: [{ address: 'a.eth' }],
      }
      writeFileSync(configPath, JSON.stringify(config))

      const manager = await startArchiverManager(configPath, config)
      expect(manager.archivers.size).toBe(1)

      // Write updated config with new board
      const newConfig: MultiArchiverConfig = {
        boards: [{ address: 'a.eth' }, { address: 'new.eth' }],
      }
      writeFileSync(configPath, JSON.stringify(newConfig))

      // Wait for debounce + async handling
      await new Promise((r) => setTimeout(r, 500))

      expect(manager.archivers.size).toBe(2)
      expect(manager.archivers.has('new.eth')).toBe(true)

      await manager.stop()
    })

    it('stops archivers when boards are removed from config', async () => {
      const stopA = makeStopFn()
      const stopB = makeStopFn()
      mockStartArchiver
        .mockResolvedValueOnce({ stop: stopA })
        .mockResolvedValueOnce({ stop: stopB })

      const dir = tmpDir()
      const configPath = join(dir, 'config.json')
      const config: MultiArchiverConfig = {
        boards: [{ address: 'a.eth' }, { address: 'b.eth' }],
      }
      writeFileSync(configPath, JSON.stringify(config))

      const manager = await startArchiverManager(configPath, config)
      expect(manager.archivers.size).toBe(2)

      // Write updated config with removed board
      const newConfig: MultiArchiverConfig = {
        boards: [{ address: 'a.eth' }],
      }
      writeFileSync(configPath, JSON.stringify(newConfig))

      // Wait for debounce + async handling
      await new Promise((r) => setTimeout(r, 500))

      expect(manager.archivers.size).toBe(1)
      expect(manager.archivers.has('a.eth')).toBe(true)
      expect(manager.archivers.has('b.eth')).toBe(false)
      expect(stopB).toHaveBeenCalledOnce()

      await manager.stop()
    })
  })

  describe('stop()', () => {
    it('calls stop on all archivers', async () => {
      const stopA = makeStopFn()
      const stopB = makeStopFn()
      mockStartArchiver
        .mockResolvedValueOnce({ stop: stopA })
        .mockResolvedValueOnce({ stop: stopB })

      const dir = tmpDir()
      const configPath = join(dir, 'config.json')
      const config: MultiArchiverConfig = {
        boards: [{ address: 'a.eth' }, { address: 'b.eth' }],
      }
      writeFileSync(configPath, JSON.stringify(config))

      const manager = await startArchiverManager(configPath, config)
      await manager.stop()

      expect(stopA).toHaveBeenCalledOnce()
      expect(stopB).toHaveBeenCalledOnce()
    })

    it('is resilient to individual stop failures', async () => {
      const stopA = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('cleanup fail'))
      const stopB = makeStopFn()
      mockStartArchiver
        .mockResolvedValueOnce({ stop: stopA })
        .mockResolvedValueOnce({ stop: stopB })

      const dir = tmpDir()
      const configPath = join(dir, 'config.json')
      const config: MultiArchiverConfig = {
        boards: [{ address: 'a.eth' }, { address: 'b.eth' }],
      }
      writeFileSync(configPath, JSON.stringify(config))

      const manager = await startArchiverManager(configPath, config)
      // Should not throw even though stopA fails
      await manager.stop()

      expect(stopA).toHaveBeenCalledOnce()
      expect(stopB).toHaveBeenCalledOnce()
    })
  })
})
