import { watch, type FSWatcher } from 'node:fs'
import Logger from '@plebbit/plebbit-logger'
import { startArchiver } from './archiver.js'
import { loadConfig, diffBoards } from './config-manager.js'
import { resolveArchiverOptions } from './multi-config.js'
import type { ArchiverResult, MultiArchiverConfig } from './types.js'

const log = Logger('5chan:manager')

export interface ArchiverManager {
  readonly archivers: ReadonlyMap<string, ArchiverResult>
  readonly errors: ReadonlyMap<string, Error>
  stop(): Promise<void>
}

/**
 * Start an archiver manager that watches the config file for changes.
 * On config change, diffs the old and new config, stops removed archivers,
 * and starts added archivers.
 */
export async function startArchiverManager(
  configPath: string,
  initialConfig: MultiArchiverConfig,
): Promise<ArchiverManager> {
  const archivers = new Map<string, ArchiverResult>()
  const errors = new Map<string, Error>()
  let currentConfig = initialConfig
  let reloading = false
  let stopped = false

  // Start initial archivers sequentially
  for (const board of initialConfig.boards) {
    const options = resolveArchiverOptions(board, initialConfig)
    try {
      log(`starting archiver for ${board.address}`)
      const result = await startArchiver(options)
      archivers.set(board.address, result)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      log.error(`failed to start archiver for ${board.address}: ${error.message}`)
      errors.set(board.address, error)
    }
  }

  async function handleConfigChange(): Promise<void> {
    if (reloading || stopped) return
    reloading = true

    try {
      let newConfig: MultiArchiverConfig
      try {
        newConfig = loadConfig(configPath)
      } catch (err) {
        log.error(`failed to reload config: ${(err as Error).message}`)
        return
      }

      const { added, removed } = diffBoards(currentConfig, newConfig)

      if (added.length === 0 && removed.length === 0) {
        currentConfig = newConfig
        return
      }

      // Stop removed archivers
      for (const address of removed) {
        const archiver = archivers.get(address)
        if (archiver) {
          try {
            log(`stopping archiver for removed board ${address}`)
            await archiver.stop()
          } catch (err) {
            log.error(`failed to stop archiver for ${address}: ${err}`)
          }
          archivers.delete(address)
        }
        errors.delete(address)
      }

      // Start added archivers
      for (const board of added) {
        const options = resolveArchiverOptions(board, newConfig)
        try {
          log(`starting archiver for added board ${board.address}`)
          const result = await startArchiver(options)
          archivers.set(board.address, result)
          errors.delete(board.address)
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err))
          log.error(`failed to start archiver for ${board.address}: ${error.message}`)
          errors.set(board.address, error)
        }
      }

      currentConfig = newConfig

      if (added.length > 0 || removed.length > 0) {
        log(`config reloaded: +${added.length} added, -${removed.length} removed, ${archivers.size} running`)
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
    get archivers() {
      return archivers as ReadonlyMap<string, ArchiverResult>
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
        [...archivers.entries()].map(async ([address, archiver]) => {
          try {
            await archiver.stop()
          } catch (err) {
            log.error(`error stopping archiver for ${address}: ${err}`)
            throw err
          }
        }),
      )
      const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      if (failures.length > 0) {
        log.error(`${failures.length} archiver(s) failed to stop cleanly`)
      }
    },
  }
}
