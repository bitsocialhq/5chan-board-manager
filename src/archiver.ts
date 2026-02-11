import Logger from '@plebbit/plebbit-logger'
import { join } from 'node:path'
import { loadState, saveState } from './state.js'
import type { ArchiverOptions, ArchiverResult, ArchiverState } from './types.js'

const log = Logger('5chan-archiver')

const DEFAULTS = {
  perPage: 15,
  pages: 10,
  bumpLimit: 300,
  archivePurgeSeconds: 172800,
} as const

export function startArchiver(options: ArchiverOptions): ArchiverResult {
  const {
    subplebbitAddress,
    plebbit,
    perPage = DEFAULTS.perPage,
    pages = DEFAULTS.pages,
    bumpLimit = DEFAULTS.bumpLimit,
    archivePurgeSeconds = DEFAULTS.archivePurgeSeconds,
  } = options

  const maxThreads = perPage * pages
  const statePath = join(plebbit.dataPath!, '5chan-archiver-state.json')
  let state: ArchiverState = loadState(statePath)
  let stopped = false

  log(`starting archiver for ${subplebbitAddress} (capacity=${maxThreads}, bumpLimit=${bumpLimit}, purgeAfter=${archivePurgeSeconds}s)`)

  async function ensureModRole(subplebbit: any, signerAddress: string): Promise<void> {
    const roles = subplebbit.roles ?? {}
    if (roles[signerAddress]?.role === 'moderator' || roles[signerAddress]?.role === 'admin' || roles[signerAddress]?.role === 'owner') {
      return
    }
    log(`adding moderator role for ${signerAddress} on ${subplebbitAddress}`)
    await subplebbit.edit({
      roles: {
        ...roles,
        [signerAddress]: { role: 'moderator' },
      },
    })
  }

  async function getOrCreateSigner(): Promise<any> {
    if (state.signers[subplebbitAddress]) {
      return plebbit.createSigner({ privateKey: state.signers[subplebbitAddress].privateKey, type: 'ed25519' })
    }
    log(`creating new signer for ${subplebbitAddress}`)
    const signer = await plebbit.createSigner()
    state.signers[subplebbitAddress] = { privateKey: signer.privateKey }
    saveState(statePath, state)
    return signer
  }

  async function lockThread(commentCid: string, signer: any, reason: string): Promise<void> {
    log(`locking thread ${commentCid} (${reason})`)
    const mod = await plebbit.createCommentModeration({
      commentCid,
      commentModeration: { locked: true },
      subplebbitAddress,
      signer,
    })
    await mod.publish()
    state.lockedThreads[commentCid] = { lockTimestamp: Math.floor(Date.now() / 1000) }
    saveState(statePath, state)
  }

  async function purgeThread(commentCid: string, signer: any): Promise<void> {
    log(`purging thread ${commentCid}`)
    const mod = await plebbit.createCommentModeration({
      commentCid,
      commentModeration: { purged: true },
      subplebbitAddress,
      signer,
    })
    await mod.publish()
    delete state.lockedThreads[commentCid]
    saveState(statePath, state)
  }

  async function handleUpdate(subplebbit: any, signer: any): Promise<void> {
    if (stopped) return

    // Build thread list from pages
    const threads: any[] = []
    // TODO: walk subplebbit.posts.pageCids.active or calculate from subplebbit.posts.pages.hot
    // For now, use preloaded hot page if available
    if (subplebbit.posts?.pages?.hot?.comments) {
      threads.push(...subplebbit.posts.pages.hot.comments)
    }

    // TODO: paginate via nextCid to get all threads

    // Filter out pinned threads
    const nonPinned = threads.filter((t: any) => !t.pinned)

    // Lock threads beyond capacity
    for (const thread of nonPinned.slice(maxThreads)) {
      if (thread.locked) continue
      if (state.lockedThreads[thread.cid]) continue
      try {
        await lockThread(thread.cid, signer, 'capacity')
      } catch (err) {
        log.error(`failed to lock thread ${thread.cid}: ${err}`)
      }
    }

    // Lock threads past bump limit
    for (const thread of nonPinned) {
      if (thread.locked) continue
      if (state.lockedThreads[thread.cid]) continue
      if ((thread.replyCount ?? 0) >= bumpLimit) {
        try {
          await lockThread(thread.cid, signer, 'bump-limit')
        } catch (err) {
          log.error(`failed to lock thread ${thread.cid}: ${err}`)
        }
      }
    }

    // Purge locked threads past archive_purge_seconds
    const now = Math.floor(Date.now() / 1000)
    for (const [cid, info] of Object.entries(state.lockedThreads)) {
      if (now - info.lockTimestamp > archivePurgeSeconds) {
        try {
          await purgeThread(cid, signer)
        } catch (err) {
          log.error(`failed to purge thread ${cid}: ${err}`)
        }
      }
    }
  }

  // Main startup
  let subplebbit: any
  const updateHandler = () => {
    getOrCreateSigner().then((signer) => handleUpdate(subplebbit, signer)).catch((err) => {
      log.error(`update handler error: ${err}`)
    })
  }

  ;(async () => {
    try {
      const signer = await getOrCreateSigner()
      subplebbit = await plebbit.getSubplebbit({ address: subplebbitAddress })
      await ensureModRole(subplebbit, signer.address)
      subplebbit.on('update', updateHandler)
      await subplebbit.update()
      log(`archiver running for ${subplebbitAddress}`)
    } catch (err) {
      log.error(`failed to start archiver: ${err}`)
    }
  })()

  return {
    stop() {
      stopped = true
      if (subplebbit) {
        subplebbit.removeListener('update', updateHandler)
        subplebbit.stop?.()
      }
      log(`archiver stopped for ${subplebbitAddress}`)
    },
  }
}
