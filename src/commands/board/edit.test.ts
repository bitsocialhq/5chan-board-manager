import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadBoardConfig, saveBoardConfig, boardConfigPath } from '../../config-manager.js'
import BoardEdit from './edit.js'

vi.mock('../../preset-editor.js', () => ({
  openInEditor: vi.fn(),
}))

import { openInEditor } from '../../preset-editor.js'

const mockOpenInEditor = vi.mocked(openInEditor)

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'board-edit-test-'))
}

function writeBoardConfig(dir: string, board: { address: string;[key: string]: unknown }): void {
  const boardsDir = join(dir, 'boards')
  mkdirSync(boardsDir, { recursive: true })
  saveBoardConfig(dir, board as Parameters<typeof saveBoardConfig>[1])
}

async function runCommand(args: string[], configDir: string): Promise<{ stdout: string; stderr: string }> {
  let stdout = ''
  let stderr = ''

  const cmd = new BoardEdit(args, {} as never)
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

describe('board edit command', () => {
  const dirs: string[] = []

  function tmpDir(): string {
    const d = makeTmpDir()
    dirs.push(d)
    return d
  }

  afterEach(() => {
    for (const d of dirs) {
      rmSync(d, { recursive: true, force: true })
    }
    dirs.length = 0
    vi.restoreAllMocks()
  })

  it('updates a field on an existing board', async () => {
    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.bso', bumpLimit: 300 })

    await runCommand(['a.bso', '--bump-limit', '500'], dir)

    const board = loadBoardConfig(boardConfigPath(dir, 'a.bso'))
    expect(board.bumpLimit).toBe(500)
  })

  it('resets a field to default', async () => {
    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.bso', perPage: 25 })

    await runCommand(['a.bso', '--reset', 'per-page'], dir)

    const board = loadBoardConfig(boardConfigPath(dir, 'a.bso'))
    expect(Object.hasOwn(board, 'perPage')).toBe(false)
  })

  it('sets and resets different fields simultaneously', async () => {
    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.bso', perPage: 25, bumpLimit: 300 })

    await runCommand(['a.bso', '--per-page', '30', '--reset', 'bump-limit'], dir)

    const board = loadBoardConfig(boardConfigPath(dir, 'a.bso'))
    expect(board.perPage).toBe(30)
    expect(Object.hasOwn(board, 'bumpLimit')).toBe(false)
  })

  it('throws when board not found', async () => {
    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.bso' })

    await expect(runCommand(['missing.bso', '--bump-limit', '500'], dir)).rejects.toThrow('not found')
  })

  it('throws when no flags provided', async () => {
    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.bso' })

    await expect(runCommand(['a.bso'], dir)).rejects.toThrow('At least one flag')
  })

  it('throws when --reset has invalid field name', async () => {
    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.bso' })

    await expect(runCommand(['a.bso', '--reset', 'invalid-field'], dir)).rejects.toThrow('Unknown field')
  })

  it('throws when setting and resetting same field', async () => {
    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.bso' })

    await expect(
      runCommand(['a.bso', '--per-page', '25', '--reset', 'per-page'], dir),
    ).rejects.toThrow('Cannot set and reset')
  })

  it('does not affect other board files', async () => {
    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.bso' })
    writeBoardConfig(dir, { address: 'b.bso', bumpLimit: 300 })

    await runCommand(['b.bso', '--bump-limit', '500'], dir)

    const boardA = loadBoardConfig(boardConfigPath(dir, 'a.bso'))
    const boardB = loadBoardConfig(boardConfigPath(dir, 'b.bso'))
    expect(boardA).toEqual({ address: 'a.bso' })
    expect(boardB.bumpLimit).toBe(500)
  })

  it('prints confirmation message', async () => {
    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.bso' })

    const { stdout } = await runCommand(['a.bso', '--bump-limit', '500'], dir)
    expect(stdout).toContain('Updated board "a.bso"')
  })

  it('throws descriptive error for unknown flag', async () => {
    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.bso' })

    await expect(runCommand(['a.bso', '--title', 'My Board'], dir)).rejects.toThrow('Unknown option: --title')
  })

  it('mentions bitsocial-cli in unknown flag error', async () => {
    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.bso' })

    await expect(runCommand(['a.bso', '--title', 'My Board'], dir)).rejects.toThrow('bitsocial-cli')
  })

  it('lists valid flags in unknown flag error', async () => {
    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.bso' })

    await expect(runCommand(['a.bso', '--title', 'My Board'], dir)).rejects.toThrow('--per-page')
  })

  it('mentions 5chan settings in unknown flag error', async () => {
    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.bso' })

    await expect(runCommand(['a.bso', '--title', 'My Board'], dir)).rejects.toThrow('5chan settings')
  })

  it('lists --interactive in unknown flag error', async () => {
    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.bso' })

    await expect(runCommand(['a.bso', '--title', 'My Board'], dir)).rejects.toThrow('--interactive')
  })
})

describe('board edit --interactive', () => {
  const dirs: string[] = []

  function tmpDir(): string {
    const d = makeTmpDir()
    dirs.push(d)
    return d
  }

  afterEach(() => {
    for (const d of dirs) {
      rmSync(d, { recursive: true, force: true })
    }
    dirs.length = 0
    vi.restoreAllMocks()
  })

  it('interactive mode saves valid edits', async () => {
    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.bso', bumpLimit: 300 })

    mockOpenInEditor.mockResolvedValueOnce(JSON.stringify({ bumpLimit: 500, perPage: 20 }, null, 2) + '\n')

    await runCommand(['a.bso', '--interactive'], dir)

    const board = loadBoardConfig(boardConfigPath(dir, 'a.bso'))
    expect(board.bumpLimit).toBe(500)
    expect(board.perPage).toBe(20)
  })

  it('interactive mode preserves the board address', async () => {
    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.bso', bumpLimit: 300 })

    mockOpenInEditor.mockResolvedValueOnce(JSON.stringify({ bumpLimit: 500 }, null, 2) + '\n')

    await runCommand(['a.bso', '--interactive'], dir)

    const board = loadBoardConfig(boardConfigPath(dir, 'a.bso'))
    expect(board.address).toBe('a.bso')
  })

  it('interactive mode rejects invalid JSON', async () => {
    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.bso' })

    mockOpenInEditor.mockResolvedValueOnce('{bad json}')

    await expect(runCommand(['a.bso', '--interactive'], dir)).rejects.toThrow('Invalid JSON')
  })

  it('interactive mode rejects unknown fields', async () => {
    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.bso' })

    mockOpenInEditor.mockResolvedValueOnce(JSON.stringify({ foo: 1 }))

    await expect(runCommand(['a.bso', '--interactive'], dir)).rejects.toThrow('Invalid config')
  })

  it('interactive mode rejects invalid field values', async () => {
    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.bso' })

    mockOpenInEditor.mockResolvedValueOnce(JSON.stringify({ perPage: -1 }))

    await expect(runCommand(['a.bso', '--interactive'], dir)).rejects.toThrow('Invalid config')
  })

  it('interactive mode allows removing optional fields', async () => {
    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.bso', bumpLimit: 300, perPage: 20 })

    mockOpenInEditor.mockResolvedValueOnce(JSON.stringify({}, null, 2) + '\n')

    await runCommand(['a.bso', '--interactive'], dir)

    const board = loadBoardConfig(boardConfigPath(dir, 'a.bso'))
    expect(board).toEqual({ address: 'a.bso' })
  })

  it('interactive mode is mutually exclusive with setting flags', async () => {
    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.bso' })

    await expect(
      runCommand(['a.bso', '--interactive', '--bump-limit', '500'], dir),
    ).rejects.toThrow()
  })

  it('interactive mode does not include address in editor content', async () => {
    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.bso', bumpLimit: 300 })

    mockOpenInEditor.mockClear()
    mockOpenInEditor.mockImplementation(async (content: string) => {
      const parsed = JSON.parse(content)
      expect(parsed).not.toHaveProperty('address')
      return content
    })

    await runCommand(['a.bso', '--interactive'], dir)

    expect(mockOpenInEditor).toHaveBeenCalledOnce()
  })
})
