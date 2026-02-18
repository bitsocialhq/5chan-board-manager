import Logger from '@plebbit/plebbit-logger'
import { startArchiver } from './archiver.js'
import { resolveArchiverOptions } from './multi-config.js'
import type { ArchiverResult, MultiArchiverConfig, MultiArchiverResult } from './types.js'

const log = Logger('5chan-archiver:multi')

/**
 * Start archivers for all boards in the config.
 *
 * Boards are started sequentially to avoid overwhelming the RPC server.
 * If a board fails to start, the error is recorded and remaining boards continue.
 * If ALL boards fail, throws an AggregateError.
 */
export async function startMultiArchiver(config: MultiArchiverConfig): Promise<MultiArchiverResult> {
  const archivers = new Map<string, ArchiverResult>()
  const errors = new Map<string, Error>()
  let stopping = false

  for (const board of config.boards) {
    if (stopping) {
      log(`skipping ${board.address} — shutdown requested`)
      break
    }

    const options = resolveArchiverOptions(board, config)
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

  if (archivers.size === 0 && errors.size > 0) {
    throw new AggregateError(
      [...errors.values()],
      `All ${errors.size} board(s) failed to start`,
    )
  }

  return {
    archivers,
    errors,
    async stop() {
      stopping = true
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
