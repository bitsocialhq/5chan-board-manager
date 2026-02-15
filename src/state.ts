import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, openSync, closeSync } from 'node:fs'
import { join, dirname } from 'node:path'
import envPaths from 'env-paths'
import type { ArchiverState, FileLock } from './types.js'

const DEFAULT_STATE: ArchiverState = {
  signers: {},
  archivedThreads: {},
}

export function defaultStateDir(): string {
  return join(envPaths('5chan-archiver').data, '5chan_archiver_states')
}

export function loadState(path: string): ArchiverState {
  try {
    const data = readFileSync(path, 'utf-8')
    return JSON.parse(data) as ArchiverState
  } catch {
    return structuredClone(DEFAULT_STATE)
  }
}

export function saveState(path: string, state: ArchiverState): void {
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
  mkdirSync(dirname(lockPath), { recursive: true })
  try {
    const fd = openSync(lockPath, 'wx')
    writeFileSync(fd, String(process.pid))
    closeSync(fd)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    // Lock file exists — check if holder is still alive
    const pidStr = readFileSync(lockPath, 'utf-8').trim()
    const pid = Number(pidStr)
    if (isPidAlive(pid)) {
      throw new Error(`Another archiver (PID ${pid}) is already running`)
    }
    // Stale lock — remove and retry
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
