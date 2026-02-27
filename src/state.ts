import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, openSync, closeSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { hostname } from 'node:os'
import envPaths from 'env-paths'
import type { BoardManagerState, FileLock } from './types.js'

const DEFAULT_STATE: BoardManagerState = {
  signers: {},
  archivedThreads: {},
}

export function defaultStateDir(): string {
  return join(envPaths('5chan-board-manager').data, '5chan_board_manager_states')
}

export function loadState(path: string): BoardManagerState {
  try {
    const data = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(data) as Partial<BoardManagerState>
    return {
      signers: parsed.signers ?? {},
      archivedThreads: parsed.archivedThreads ?? {},
    }
  } catch {
    return structuredClone(DEFAULT_STATE)
  }
}

export function saveState(path: string, state: BoardManagerState): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmpPath = path + '.tmp'
  try {
    writeFileSync(tmpPath, JSON.stringify(state, null, 2) + '\n')
    renameSync(tmpPath, path)
  } catch (err) {
    try { unlinkSync(tmpPath) } catch {}
    throw err
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function acquireLock(statePath: string): FileLock {
  const lockPath = statePath + '.lock'
  const currentHostname = hostname()
  mkdirSync(dirname(lockPath), { recursive: true })
  try {
    const fd = openSync(lockPath, 'wx')
    writeFileSync(fd, `${process.pid}\n${currentHostname}`)
    closeSync(fd)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    // Lock file exists — check if holder is still alive
    const content = readFileSync(lockPath, 'utf-8').trim()
    const lines = content.split('\n')
    const pid = Number(lines[0])
    const storedHostname = lines[1] // undefined for old-format lock files
    const sameHost = storedHostname === undefined || storedHostname === currentHostname
    if (sameHost && isPidAlive(pid)) {
      throw new Error(`Another board manager (PID ${pid}) is already running`)
    }
    // Stale lock — different host or dead PID — remove and retry
    unlinkSync(lockPath)
    return acquireLock(statePath)
  }
  return {
    lockPath,
    release() {
      try { unlinkSync(lockPath) } catch {}
    },
  }
}
