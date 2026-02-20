import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { saveBoardConfig } from '../../config-manager.js'
import BoardList from './list.js'

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'board-list-test-'))
}

function writeBoardConfig(dir: string, board: { address: string;[key: string]: unknown }): void {
  saveBoardConfig(dir, board as Parameters<typeof saveBoardConfig>[1])
}

async function runCommand(args: string[], configDir: string): Promise<{ stdout: string }> {
  let stdout = ''

  const cmd = new BoardList(args, {} as never)
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

describe('board list command', () => {
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

  it('shows empty state message when no boards configured', async () => {
    const dir = tmpDir()
    const { stdout } = await runCommand([], dir)
    expect(stdout).toContain('No boards configured')
  })

  it('lists boards', async () => {
    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.bso' })
    writeBoardConfig(dir, { address: 'b.bso' })

    const { stdout } = await runCommand([], dir)
    expect(stdout).toContain('a.bso')
    expect(stdout).toContain('b.bso')
  })

  it('outputs one address per line', async () => {
    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.bso' })
    writeBoardConfig(dir, { address: 'b.bso' })
    writeBoardConfig(dir, { address: 'c.bso' })

    const { stdout } = await runCommand([], dir)
    const lines = stdout.trim().split('\n')
    expect(lines).toHaveLength(3)
  })

  it('outputs only addresses with no extra text', async () => {
    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.bso', bumpLimit: 500, perPage: 30 })

    const { stdout } = await runCommand([], dir)
    expect(stdout).not.toContain('bumpLimit')
    expect(stdout).not.toContain('perPage')
    expect(stdout).not.toContain('Boards')
    expect(stdout).not.toContain('Config:')
    expect(stdout).not.toContain('RPC URL:')
    expect(stdout.trim()).toBe('a.bso')
  })
})
