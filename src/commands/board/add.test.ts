import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('../../board-validator.js', () => ({
  validateBoardAddress: vi.fn(),
}))

import { validateBoardAddress } from '../../board-validator.js'
import { loadConfig } from '../../config-manager.js'
import BoardAdd from './add.js'

const mockValidate = vi.mocked(validateBoardAddress)

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'board-add-test-'))
}

async function runCommand(args: string[], configDir: string): Promise<{ stdout: string; stderr: string }> {
  let stdout = ''
  let stderr = ''

  const cmd = new BoardAdd(args, {} as never)
  Object.defineProperty(cmd, 'config', {
    value: {
      configDir,
      runHook: async () => ({ successes: [], failures: [] }),
    },
  })
  // Capture output
  cmd.log = (...logArgs: string[]) => {
    stdout += logArgs.join(' ') + '\n'
  }
  cmd.warn = ((...warnArgs: [string | Error]) => {
    stderr += String(warnArgs[0]) + '\n'
  }) as typeof cmd.warn

  await cmd.run()

  return { stdout, stderr }
}

describe('board add command', () => {
  const dirs: string[] = []

  function tmpDir(): string {
    const d = makeTmpDir()
    dirs.push(d)
    return d
  }

  beforeEach(() => {
    mockValidate.mockReset()
    mockValidate.mockResolvedValue(undefined)
  })

  afterEach(() => {
    for (const d of dirs) {
      rmSync(d, { recursive: true, force: true })
    }
    dirs.length = 0
  })

  it('adds a board to an empty config', async () => {
    const dir = tmpDir()
    await runCommand(['new-board.eth'], dir)

    const configPath = join(dir, 'config.json')
    const config = loadConfig(configPath)
    expect(config.boards).toHaveLength(1)
    expect(config.boards[0].address).toBe('new-board.eth')
  })

  it('validates board address before adding', async () => {
    const dir = tmpDir()
    await runCommand(['board.eth', '--rpc-url', 'ws://test:9138'], dir)

    expect(mockValidate).toHaveBeenCalledWith('board.eth', 'ws://test:9138')
  })

  it('adds a board with per-board overrides', async () => {
    const dir = tmpDir()
    await runCommand([
      'board.eth',
      '--per-page', '25',
      '--pages', '5',
      '--bump-limit', '500',
      '--archive-purge-seconds', '86400',
    ], dir)

    const configPath = join(dir, 'config.json')
    const config = loadConfig(configPath)
    expect(config.boards[0]).toEqual({
      address: 'board.eth',
      perPage: 25,
      pages: 5,
      bumpLimit: 500,
      archivePurgeSeconds: 86400,
    })
  })

  it('appends to existing boards', async () => {
    const dir = tmpDir()
    const configPath = join(dir, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      boards: [{ address: 'existing.eth' }],
    }))

    await runCommand(['new.eth'], dir)

    const config = loadConfig(configPath)
    expect(config.boards).toHaveLength(2)
    expect(config.boards[0].address).toBe('existing.eth')
    expect(config.boards[1].address).toBe('new.eth')
  })

  it('throws when board already exists', async () => {
    const dir = tmpDir()
    const configPath = join(dir, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      boards: [{ address: 'dup.eth' }],
    }))

    await expect(runCommand(['dup.eth'], dir)).rejects.toThrow('already exists')
  })

  it('throws when validation fails', async () => {
    mockValidate.mockRejectedValue(new Error('Subplebbit not found'))
    const dir = tmpDir()

    await expect(runCommand(['bad.eth'], dir)).rejects.toThrow('Subplebbit not found')
  })

  it('prints confirmation message', async () => {
    const dir = tmpDir()
    const { stdout } = await runCommand(['board.eth'], dir)
    expect(stdout).toContain('Added board "board.eth"')
  })
})
