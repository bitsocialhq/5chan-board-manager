import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { startBoardManagers } from './board-managers.js'
import type { BoardManagerOptions, BoardManagerResult, MultiBoardConfig } from './types.js'

vi.mock('./board-manager.js', () => ({
  startBoardManager: vi.fn(),
}))

import { startBoardManager } from './board-manager.js'

const mockStartBoardManager = vi.mocked(startBoardManager)

function makeStopFn(): BoardManagerResult['stop'] {
  return vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
}

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'board-managers-test-'))
}

function writeGlobalConfig(dir: string, config: unknown): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'global.json'), JSON.stringify(config))
}

function writeBoardConfig(dir: string, board: { address: string;[key: string]: unknown }): void {
  const boardsDir = join(dir, 'boards')
  mkdirSync(boardsDir, { recursive: true })
  writeFileSync(join(boardsDir, `${board.address}.json`), JSON.stringify(board))
}

describe('startBoardManagers', () => {
  const dirs: string[] = []

  function tmpDir(): string {
    const d = makeTmpDir()
    dirs.push(d)
    return d
  }

  beforeEach(() => {
    mockStartBoardManager.mockReset()
  })

  afterEach(async () => {
    for (const d of dirs) {
      rmSync(d, { recursive: true, force: true })
    }
    dirs.length = 0
  })

  it('starts board managers for all boards in initial config', async () => {
    const stopA = makeStopFn()
    const stopB = makeStopFn()
    mockStartBoardManager
      .mockResolvedValueOnce({ stop: stopA })
      .mockResolvedValueOnce({ stop: stopB })

    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.bso' })
    writeBoardConfig(dir, { address: 'b.bso' })
    const config: MultiBoardConfig = {
      boards: [{ address: 'a.bso' }, { address: 'b.bso' }],
    }

    const manager = await startBoardManagers(dir, config)

    expect(manager.boardManagers.size).toBe(2)
    expect(manager.boardManagers.has('a.bso')).toBe(true)
    expect(manager.boardManagers.has('b.bso')).toBe(true)
    expect(manager.errors.size).toBe(0)

    await manager.stop()
  })

  it('records failed boards in errors map and continues', async () => {
    mockStartBoardManager
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce({ stop: makeStopFn() })

    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.bso' })
    writeBoardConfig(dir, { address: 'b.bso' })
    const config: MultiBoardConfig = {
      boards: [{ address: 'a.bso' }, { address: 'b.bso' }],
    }

    const manager = await startBoardManagers(dir, config)

    expect(manager.boardManagers.size).toBe(1)
    expect(manager.boardManagers.has('b.bso')).toBe(true)
    expect(manager.errors.size).toBe(1)
    expect(manager.errors.get('a.bso')?.message).toBe('connection refused')

    await manager.stop()
  })

  it('throws AggregateError when all boards fail to start', async () => {
    mockStartBoardManager
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockRejectedValueOnce(new Error('timeout'))

    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.bso' })
    writeBoardConfig(dir, { address: 'b.bso' })
    const config: MultiBoardConfig = {
      boards: [{ address: 'a.bso' }, { address: 'b.bso' }],
    }

    await expect(startBoardManagers(dir, config)).rejects.toThrow(
      'All 2 board(s) failed to start',
    )
  })

  it('starts with empty config', async () => {
    const dir = tmpDir()
    mkdirSync(join(dir, 'boards'), { recursive: true })
    const config: MultiBoardConfig = { boards: [] }

    const manager = await startBoardManagers(dir, config)

    expect(manager.boardManagers.size).toBe(0)
    expect(manager.errors.size).toBe(0)

    await manager.stop()
  })

  it('passes correct options to startBoardManager', async () => {
    mockStartBoardManager.mockResolvedValue({ stop: makeStopFn() })

    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'x.bso', bumpLimit: 500 })
    const config: MultiBoardConfig = {
      rpcUrl: 'ws://test:9138',
      stateDir: '/test/state',
      defaults: { perPage: 20 },
      boards: [{ address: 'x.bso', bumpLimit: 500 }],
    }

    const manager = await startBoardManagers(dir, config)

    const opts = mockStartBoardManager.mock.calls[0][0] as BoardManagerOptions
    expect(opts.subplebbitAddress).toBe('x.bso')
    expect(opts.plebbitRpcUrl).toBe('ws://test:9138')
    expect(opts.stateDir).toBe('/test/state')
    expect(opts.perPage).toBe(20)
    expect(opts.bumpLimit).toBe(500)

    await manager.stop()
  })

  describe('hot-reload', () => {
    it('starts new board managers when boards are added to config', async () => {
      const stopA = makeStopFn()
      const stopNew = makeStopFn()
      mockStartBoardManager
        .mockResolvedValueOnce({ stop: stopA })
        .mockResolvedValueOnce({ stop: stopNew })

      const dir = tmpDir()
      writeBoardConfig(dir, { address: 'a.bso' })
      const config: MultiBoardConfig = {
        boards: [{ address: 'a.bso' }],
      }

      const manager = await startBoardManagers(dir, config)
      expect(manager.boardManagers.size).toBe(1)

      // Add new board config file
      writeBoardConfig(dir, { address: 'new.bso' })

      // Wait for debounce + async handling
      await new Promise((r) => setTimeout(r, 500))

      expect(manager.boardManagers.size).toBe(2)
      expect(manager.boardManagers.has('new.bso')).toBe(true)

      await manager.stop()
    })

    it('restarts board managers when board config changes', async () => {
      const stopA = makeStopFn()
      const stopNew = makeStopFn()
      mockStartBoardManager
        .mockResolvedValueOnce({ stop: stopA })
        .mockResolvedValueOnce({ stop: stopNew })

      const dir = tmpDir()
      writeBoardConfig(dir, { address: 'a.bso', bumpLimit: 300 })
      const config: MultiBoardConfig = {
        boards: [{ address: 'a.bso', bumpLimit: 300 }],
      }

      const manager = await startBoardManagers(dir, config)
      expect(manager.boardManagers.size).toBe(1)

      // Update board config file with changed bumpLimit
      writeBoardConfig(dir, { address: 'a.bso', bumpLimit: 500 })

      // Wait for debounce + async handling
      await new Promise((r) => setTimeout(r, 500))

      expect(stopA).toHaveBeenCalledOnce()
      expect(mockStartBoardManager).toHaveBeenCalledTimes(2)
      expect(manager.boardManagers.size).toBe(1)
      expect(manager.boardManagers.has('a.bso')).toBe(true)

      await manager.stop()
    })

    it('records error when restart of changed board fails', async () => {
      const stopA = makeStopFn()
      mockStartBoardManager
        .mockResolvedValueOnce({ stop: stopA })
        .mockRejectedValueOnce(new Error('restart failed'))

      const dir = tmpDir()
      writeBoardConfig(dir, { address: 'a.bso', bumpLimit: 300 })
      const config: MultiBoardConfig = {
        boards: [{ address: 'a.bso', bumpLimit: 300 }],
      }

      const manager = await startBoardManagers(dir, config)
      expect(manager.boardManagers.size).toBe(1)

      // Update board config file with changed bumpLimit
      writeBoardConfig(dir, { address: 'a.bso', bumpLimit: 500 })

      // Wait for debounce + async handling
      await new Promise((r) => setTimeout(r, 500))

      expect(stopA).toHaveBeenCalledOnce()
      expect(manager.boardManagers.has('a.bso')).toBe(false)
      expect(manager.errors.size).toBe(1)
      expect(manager.errors.get('a.bso')?.message).toBe('restart failed')

      await manager.stop()
    })

    it('stops board managers when boards are removed from config', async () => {
      const stopA = makeStopFn()
      const stopB = makeStopFn()
      mockStartBoardManager
        .mockResolvedValueOnce({ stop: stopA })
        .mockResolvedValueOnce({ stop: stopB })

      const dir = tmpDir()
      writeBoardConfig(dir, { address: 'a.bso' })
      writeBoardConfig(dir, { address: 'b.bso' })
      const config: MultiBoardConfig = {
        boards: [{ address: 'a.bso' }, { address: 'b.bso' }],
      }

      const manager = await startBoardManagers(dir, config)
      expect(manager.boardManagers.size).toBe(2)

      // Remove board config file
      unlinkSync(join(dir, 'boards', 'b.bso.json'))

      // Wait for debounce + async handling
      await new Promise((r) => setTimeout(r, 500))

      expect(manager.boardManagers.size).toBe(1)
      expect(manager.boardManagers.has('a.bso')).toBe(true)
      expect(manager.boardManagers.has('b.bso')).toBe(false)
      expect(stopB).toHaveBeenCalledOnce()

      await manager.stop()
    })
  })

  describe('stop()', () => {
    it('calls stop on all board managers', async () => {
      const stopA = makeStopFn()
      const stopB = makeStopFn()
      mockStartBoardManager
        .mockResolvedValueOnce({ stop: stopA })
        .mockResolvedValueOnce({ stop: stopB })

      const dir = tmpDir()
      writeBoardConfig(dir, { address: 'a.bso' })
      writeBoardConfig(dir, { address: 'b.bso' })
      const config: MultiBoardConfig = {
        boards: [{ address: 'a.bso' }, { address: 'b.bso' }],
      }

      const manager = await startBoardManagers(dir, config)
      await manager.stop()

      expect(stopA).toHaveBeenCalledOnce()
      expect(stopB).toHaveBeenCalledOnce()
    })

    it('is resilient to individual stop failures', async () => {
      const stopA = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('cleanup fail'))
      const stopB = makeStopFn()
      mockStartBoardManager
        .mockResolvedValueOnce({ stop: stopA })
        .mockResolvedValueOnce({ stop: stopB })

      const dir = tmpDir()
      writeBoardConfig(dir, { address: 'a.bso' })
      writeBoardConfig(dir, { address: 'b.bso' })
      const config: MultiBoardConfig = {
        boards: [{ address: 'a.bso' }, { address: 'b.bso' }],
      }

      const manager = await startBoardManagers(dir, config)
      // Should not throw even though stopA fails
      await manager.stop()

      expect(stopA).toHaveBeenCalledOnce()
      expect(stopB).toHaveBeenCalledOnce()
    })
  })
})
