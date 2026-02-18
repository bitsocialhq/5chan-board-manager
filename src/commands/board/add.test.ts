import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('../../board-validator.js', () => ({
  validateBoardAddress: vi.fn(),
}))

vi.mock('../../community-defaults.js', () => ({
  applyCommunityDefaultsToBoard: vi.fn(),
  getCommunityDefaultsPreset: vi.fn(),
  loadCommunityDefaultsPreset: vi.fn(),
}))

import { validateBoardAddress } from '../../board-validator.js'
import {
  applyCommunityDefaultsToBoard,
  getCommunityDefaultsPreset,
  loadCommunityDefaultsPreset,
} from '../../community-defaults.js'
import { loadConfig } from '../../config-manager.js'
import BoardAdd from './add.js'

const mockValidate = vi.mocked(validateBoardAddress)
const mockApplyDefaults = vi.mocked(applyCommunityDefaultsToBoard)
const mockGetPreset = vi.mocked(getCommunityDefaultsPreset)
const mockLoadPreset = vi.mocked(loadCommunityDefaultsPreset)

interface RunCommandOptions {
  interactive?: boolean
  promptAnswer?: boolean
}

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'board-add-test-'))
}

async function runCommand(
  args: string[],
  configDir: string,
  options: RunCommandOptions = {},
): Promise<{ stdout: string; stderr: string }> {
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
  ;(cmd as unknown as { isInteractive: () => boolean }).isInteractive = () => options.interactive ?? true
  ;(cmd as unknown as { promptApplyDefaults: () => Promise<boolean> }).promptApplyDefaults = async () =>
    options.promptAnswer ?? true

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
    mockApplyDefaults.mockReset()
    mockApplyDefaults.mockResolvedValue({ applied: true, changedFields: ['features'] })
    mockGetPreset.mockReset()
    mockGetPreset.mockResolvedValue({
      boardSettings: { features: { noUpvotes: true } },
      boardManagerSettings: {
        perPage: 15,
        pages: 10,
        bumpLimit: 300,
        archivePurgeSeconds: 172800,
      },
    })
    mockLoadPreset.mockReset()
    mockLoadPreset.mockResolvedValue({
      boardSettings: { features: { requirePostLink: true } },
      boardManagerSettings: {
        perPage: 25,
      },
    })
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
    expect(config.boards[0]).toEqual({
      address: 'new-board.eth',
      perPage: 15,
      pages: 10,
      bumpLimit: 300,
      archivePurgeSeconds: 172800,
    })
  })

  it('validates board address before adding', async () => {
    const dir = tmpDir()
    await runCommand(['board.eth', '--rpc-url', 'ws://test:9138'], dir)

    expect(mockValidate).toHaveBeenCalledWith('board.eth', 'ws://test:9138')
  })

  it('applies defaults by default in interactive mode', async () => {
    const dir = tmpDir()
    await runCommand(['board.eth'], dir)
    expect(mockApplyDefaults).toHaveBeenCalledWith(
      'board.eth',
      'ws://localhost:9138',
      await mockGetPreset.mock.results[0].value,
    )
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
    expect(config.boards[1]).toEqual({
      address: 'new.eth',
      perPage: 15,
      pages: 10,
      bumpLimit: 300,
      archivePurgeSeconds: 172800,
    })
  })

  it('throws when board already exists', async () => {
    const dir = tmpDir()
    const configPath = join(dir, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      boards: [{ address: 'dup.eth' }],
    }))

    await expect(runCommand(['dup.eth'], dir)).rejects.toThrow('already exists')
  })

  it('errors when both apply and skip flags are provided', async () => {
    const dir = tmpDir()
    await expect(
      runCommand(['board.eth', '--apply-defaults', '--skip-apply-defaults'], dir),
    ).rejects.toThrow('Cannot use both --apply-defaults and --skip-apply-defaults')
  })

  it('errors in non-interactive mode when no defaults decision flag is provided', async () => {
    const dir = tmpDir()
    await expect(runCommand(['board.eth'], dir, { interactive: false })).rejects.toThrow(
      'Non-interactive mode requires --apply-defaults or --skip-apply-defaults',
    )
  })

  it('skips applying defaults when --skip-apply-defaults is set', async () => {
    const dir = tmpDir()
    await runCommand(['board.eth', '--skip-apply-defaults'], dir, { interactive: false })
    expect(mockApplyDefaults).not.toHaveBeenCalled()
  })

  it('applies defaults in non-interactive mode when --apply-defaults is set', async () => {
    const dir = tmpDir()
    await runCommand(['board.eth', '--apply-defaults'], dir, { interactive: false })
    expect(mockApplyDefaults).toHaveBeenCalledOnce()
  })

  it('uses prompt answer when no defaults decision flag is provided', async () => {
    const dir = tmpDir()
    await runCommand(['board.eth'], dir, { promptAnswer: false })
    expect(mockApplyDefaults).not.toHaveBeenCalled()
  })

  it('loads custom preset file when --defaults-preset is provided', async () => {
    const dir = tmpDir()
    const presetPath = join(dir, 'preset.json')
    writeFileSync(presetPath, JSON.stringify({
      boardSettings: { features: { noUpvotes: true } },
      boardManagerSettings: { perPage: 25 },
    }))

    await runCommand(
      ['board.eth', '--apply-defaults', '--defaults-preset', presetPath],
      dir,
      { interactive: false },
    )

    expect(mockLoadPreset).toHaveBeenCalledWith(presetPath)

    const config = loadConfig(join(dir, 'config.json'))
    expect(config.boards[0].perPage).toBe(25)
  })

  it('fails command and does not add board if applying defaults fails', async () => {
    const dir = tmpDir()
    const configPath = join(dir, 'config.json')
    writeFileSync(configPath, JSON.stringify({
      boards: [{ address: 'existing.eth' }],
    }))

    mockApplyDefaults.mockRejectedValue(new Error('no moderator rights'))
    await expect(
      runCommand(['new.eth', '--apply-defaults'], dir, { interactive: false }),
    ).rejects.toThrow('no moderator rights')

    const config = loadConfig(configPath)
    expect(config.boards).toHaveLength(1)
    expect(config.boards[0].address).toBe('existing.eth')
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
