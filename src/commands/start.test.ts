import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { saveBoardConfig, saveGlobalConfig } from '../config-manager.js'

vi.mock('../board-managers.js', () => ({
  startBoardManagers: vi.fn(),
}))

import { startBoardManagers } from '../board-managers.js'
import type { BoardManagers } from '../board-managers.js'
import Start from './start.js'

const mockStartManager = vi.mocked(startBoardManagers)

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'start-test-'))
}

function writeBoardConfig(dir: string, board: { address: string;[key: string]: unknown }): void {
  saveBoardConfig(dir, board as Parameters<typeof saveBoardConfig>[1])
}

function makeMockManager(overrides?: Partial<BoardManagers>): BoardManagers {
  return {
    boardManagers: new Map(),
    errors: new Map(),
    stop: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    ...overrides,
  }
}

async function runCommand(args: string[], configDir: string): Promise<{ stdout: string; stderr: string }> {
  let stdout = ''
  let stderr = ''

  const cmd = new Start(args, {} as never)
  Object.defineProperty(cmd, 'config', {
    value: {
      configDir,
      runHook: async () => ({ successes: [], failures: [] }),
    },
  })
  cmd.log = (...logArgs: string[]) => {
    stdout += logArgs.join(' ') + '\n'
  }
  cmd.warn = ((...warnArgs: [string | Error]) => {
    stderr += String(warnArgs[0]) + '\n'
  }) as typeof cmd.warn

  await cmd.run()

  return { stdout, stderr }
}

describe('start command', () => {
  const dirs: string[] = []

  function tmpDir(): string {
    const d = makeTmpDir()
    dirs.push(d)
    return d
  }

  beforeEach(() => {
    mockStartManager.mockReset()
  })

  afterEach(() => {
    for (const d of dirs) {
      rmSync(d, { recursive: true, force: true })
    }
    dirs.length = 0
  })

  it('errors when no boards are configured', async () => {
    const dir = tmpDir()
    await expect(runCommand([], dir)).rejects.toThrow('No boards configured')
  })

  it('starts board managers with correct config', async () => {
    const manager = makeMockManager({
      boardManagers: new Map([['a.eth', { stop: vi.fn() }]]),
    })
    mockStartManager.mockResolvedValue(manager)

    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.eth' })

    await runCommand([], dir)

    expect(mockStartManager).toHaveBeenCalledOnce()
    const [configDir, config] = mockStartManager.mock.calls[0]
    expect(configDir).toBe(dir)
    expect(config.boards[0].address).toBe('a.eth')
  })

  it('uses custom config dir when --config-dir flag provided', async () => {
    const manager = makeMockManager({
      boardManagers: new Map([['a.eth', { stop: vi.fn() }]]),
    })
    mockStartManager.mockResolvedValue(manager)

    const dir = tmpDir()
    const customDir = join(dir, 'custom')
    writeBoardConfig(customDir, { address: 'a.eth' })

    await runCommand(['--config-dir', customDir], dir)

    const [configDir] = mockStartManager.mock.calls[0]
    expect(configDir).toBe(customDir)
  })

  it('prints startup summary', async () => {
    const manager = makeMockManager({
      boardManagers: new Map([['a.eth', { stop: vi.fn() }]]),
    })
    mockStartManager.mockResolvedValue(manager)

    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.eth' })

    const { stdout } = await runCommand([], dir)
    expect(stdout).toContain('Starting board managers for 1 board(s)')
    expect(stdout).toContain('Started 1 board manager(s)')
  })

  it('propagates error when startBoardManagers throws', async () => {
    mockStartManager.mockRejectedValue(
      new AggregateError(
        [new Error('connection refused')],
        'All 1 board(s) failed to start',
      ),
    )

    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.eth' })

    await expect(runCommand([], dir)).rejects.toThrow(
      'All 1 board(s) failed to start',
    )
  })

  it('reports failed boards in startup summary', async () => {
    const manager = makeMockManager({
      boardManagers: new Map([['a.eth', { stop: vi.fn() }]]),
      errors: new Map([['b.eth', new Error('connection refused')]]),
    })
    mockStartManager.mockResolvedValue(manager)

    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.eth' })
    writeBoardConfig(dir, { address: 'b.eth' })

    const { stdout, stderr } = await runCommand([], dir)
    expect(stdout).toContain('1 failed')
    expect(stderr).toContain('FAILED: b.eth')
    expect(stderr).toContain('connection refused')
  })
})
