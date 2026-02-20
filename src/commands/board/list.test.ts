import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { saveBoardConfig, saveGlobalConfig } from '../../config-manager.js'
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
    writeBoardConfig(dir, { address: 'a.eth' })
    writeBoardConfig(dir, { address: 'b.eth' })

    const { stdout } = await runCommand([], dir)
    expect(stdout).toContain('a.eth')
    expect(stdout).toContain('b.eth')
    expect(stdout).toContain('Boards (2)')
  })

  it('shows per-board overrides', async () => {
    const dir = tmpDir()
    writeBoardConfig(dir, { address: 'a.eth', bumpLimit: 500, perPage: 30 })

    const { stdout } = await runCommand([], dir)
    expect(stdout).toContain('bumpLimit=500')
    expect(stdout).toContain('perPage=30')
  })

  it('shows RPC URL from config', async () => {
    const dir = tmpDir()
    saveGlobalConfig(dir, { rpcUrl: 'ws://custom:9138' })
    writeBoardConfig(dir, { address: 'a.eth' })

    const { stdout } = await runCommand([], dir)
    expect(stdout).toContain('ws://custom:9138')
  })

  it('shows default RPC URL when not configured', async () => {
    const dir = tmpDir()
    const { stdout } = await runCommand([], dir)
    expect(stdout).toContain('default: ws://localhost:9138')
  })

  it('shows config directory path', async () => {
    const dir = tmpDir()
    const { stdout } = await runCommand([], dir)
    expect(stdout).toContain(dir)
  })
})
