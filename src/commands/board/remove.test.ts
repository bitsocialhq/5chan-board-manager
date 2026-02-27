import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { saveBoardConfig, loadConfig } from '../../config-manager.js'
import BoardRemove from './remove.js'

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'board-remove-test-'))
}

function writeBoardConfig(dir: string, board: { address: string;[key: string]: unknown }): void {
  const boardsDir = join(dir, 'boards')
  mkdirSync(boardsDir, { recursive: true })
  saveBoardConfig(dir, board as Parameters<typeof saveBoardConfig>[1])
}

async function runCommand(args: string[], configDir: string): Promise<{ stdout: string }> {
  let stdout = ''

  const cmd = new BoardRemove(args, {} as never)
  Object.defineProperty(cmd, 'config', {
    value: {
      configDir,
      runHook: async () => ({ successes: [], failures: [] }),
    },
  })
  cmd.log = (...logArgs: string[]) => {
    stdout += logArgs.join(' ') + '\n'
  }

  await cmd.run()

  return { stdout }
}

describe('board remove command', () => {
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
  })

  it('removes a board from the config', async () => {
    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.bso' })
    writeBoardConfig(dir, { address: 'b.bso' })

    await runCommand(['a.bso'], dir)

    expect(existsSync(join(dir, 'boards', 'a.bso'))).toBe(false)
    expect(existsSync(join(dir, 'boards', 'b.bso', 'config.json'))).toBe(true)
  })

  it('throws when board not found', async () => {
    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.bso' })

    await expect(runCommand(['missing.bso'], dir)).rejects.toThrow('not found')
  })

  it('prints confirmation message', async () => {
    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'board.bso' })

    const { stdout } = await runCommand(['board.bso'], dir)
    expect(stdout).toContain('Removed board "board.bso"')
  })

  it('does not affect other board files', async () => {
    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.bso' })
    writeBoardConfig(dir, { address: 'b.bso' })

    await runCommand(['a.bso'], dir)

    const config = loadConfig(dir)
    expect(config.boards).toHaveLength(1)
    expect(config.boards[0].address).toBe('b.bso')
  })
})
