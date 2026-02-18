import { watch, type FSWatcher } from 'node:fs'
import Logger from '@plebbit/plebbit-logger'
import { startBoardManager } from './board-manager.js'
import { loadConfig, diffBoards } from './config-manager.js'
import { resolveBoardManagerOptions } from './multi-config.js'
import type { BoardManagerResult, MultiBoardConfig } from './types.js'

const log = Logger('5chan:board-manager')

export interface BoardManagers {
  readonly boardManagers: ReadonlyMap<string, BoardManagerResult>
  readonly errors: ReadonlyMap<string, Error>
  stop(): Promise<void>
}

/**
 * Start board managers that watch the config file for changes.
 * On config change, diffs the old and new config, stops removed board managers,
 * and starts added board managers.
 */
export async function startBoardManagers(
  configPath: string,
  initialConfig: MultiBoardConfig,
): Promise<BoardManagers> {
  const boardManagers = new Map<string, BoardManagerResult>()
  const errors = new Map<string, Error>()
  let currentConfig = initialConfig
  let reloading = false
  let stopped = false

  // Start initial board managers sequentially
  for (const board of initialConfig.boards) {
    const options = resolveBoardManagerOptions(board, initialConfig)
    try {
      log(`starting board manager for ${board.address}`)
      const result = await startBoardManager(options)
      boardManagers.set(board.address, result)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      log.error(`failed to start board manager for ${board.address}: ${error.message}`)
      errors.set(board.address, error)
    }
  }

  if (boardManagers.size === 0 && errors.size > 0) {
    throw new AggregateError(
      [...errors.values()],
      `All ${errors.size} board(s) failed to start`,
    )
  }

  async function handleConfigChange(): Promise<void> {
    if (reloading || stopped) return
    reloading = true

    try {
      let newConfig: MultiBoardConfig
      try {
        newConfig = loadConfig(configPath)
      } catch (err) {
        log.error(`failed to reload config: ${(err as Error).message}`)
        return
      }

      const { added, removed, changed } = diffBoards(currentConfig, newConfig)

      if (added.length === 0 && removed.length === 0 && changed.length === 0) {
        currentConfig = newConfig
        return
      }

      // Stop removed board managers
      for (const address of removed) {
        const manager = boardManagers.get(address)
        if (manager) {
          try {
            log(`stopping board manager for removed board ${address}`)
            await manager.stop()
          } catch (err) {
            log.error(`failed to stop board manager for ${address}: ${err}`)
          }
          boardManagers.delete(address)
        }
        errors.delete(address)
      }

      // Restart changed board managers
      for (const board of changed) {
        const manager = boardManagers.get(board.address)
        if (manager) {
          try {
            log(`stopping board manager for changed board ${board.address}`)
            await manager.stop()
          } catch (err) {
            log.error(`failed to stop board manager for ${board.address}: ${err}`)
          }
          boardManagers.delete(board.address)
        }
        errors.delete(board.address)

        const options = resolveBoardManagerOptions(board, newConfig)
        try {
          log(`starting board manager for changed board ${board.address}`)
          const result = await startBoardManager(options)
          boardManagers.set(board.address, result)
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err))
          log.error(`failed to start board manager for ${board.address}: ${error.message}`)
          errors.set(board.address, error)
        }
      }

      // Start added board managers
      for (const board of added) {
        const options = resolveBoardManagerOptions(board, newConfig)
        try {
          log(`starting board manager for added board ${board.address}`)
          const result = await startBoardManager(options)
          boardManagers.set(board.address, result)
          errors.delete(board.address)
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err))
          log.error(`failed to start board manager for ${board.address}: ${error.message}`)
          errors.set(board.address, error)
        }
      }

      currentConfig = newConfig

      if (added.length > 0 || removed.length > 0 || changed.length > 0) {
        log(`config reloaded: +${added.length} added, -${removed.length} removed, ~${changed.length} changed, ${boardManagers.size} running`)
      }
    } finally {
      reloading = false
    }
  }

  // Watch config file for changes with debounce
  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  let watcher: FSWatcher | undefined

  try {
    watcher = watch(configPath, () => {
      if (stopped) return
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        handleConfigChange()
      }, 200)
    })
  } catch {
    log(`config file does not exist yet, skipping watch`)
  }

  return {
    get boardManagers() {
      return boardManagers as ReadonlyMap<string, BoardManagerResult>
    },
    get errors() {
      return errors as ReadonlyMap<string, Error>
    },
    async stop() {
      stopped = true
      if (debounceTimer) clearTimeout(debounceTimer)
      if (watcher) {
        watcher.close()
      }
      const results = await Promise.allSettled(
        [...boardManagers.entries()].map(async ([address, manager]) => {
          try {
            await manager.stop()
          } catch (err) {
            log.error(`error stopping board manager for ${address}: ${err}`)
            throw err
          }
        }),
      )
      const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      if (failures.length > 0) {
        log.error(`${failures.length} board manager(s) failed to stop cleanly`)
      }
    },
  }
}
