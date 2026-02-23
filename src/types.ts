import type PlebbitFn from '@plebbit/plebbit-js'

/** The Plebbit instance type returned by `await Plebbit()` */
export type PlebbitInstance = Awaited<ReturnType<typeof PlebbitFn>>

/** Subplebbit returned by `plebbit.getSubplebbit()` */
export type Subplebbit = Awaited<ReturnType<PlebbitInstance['getSubplebbit']>>

/** Signer returned by `plebbit.createSigner()` */
export type Signer = Awaited<ReturnType<PlebbitInstance['createSigner']>>

/** Comment returned by `plebbit.getComment()` */
export type Comment = Awaited<ReturnType<PlebbitInstance['getComment']>>

/** A single page returned by `subplebbit.posts.getPage()` */
export type Page = Awaited<ReturnType<Subplebbit['posts']['getPage']>>

/** A comment/thread within a page */
export type ThreadComment = Page['comments'][number]

export interface ModerationReasons {
  archiveCapacity?: string
  archiveBumpLimit?: string
  purgeArchived?: string
  purgeDeleted?: string
}

export interface BoardManagerOptions {
  subplebbitAddress: string
  plebbitRpcUrl: string
  stateDir?: string
  perPage?: number
  pages?: number
  bumpLimit?: number
  archivePurgeSeconds?: number
  moderationReasons?: ModerationReasons
  onAddressChange?: (oldAddress: string, newAddress: string) => void
}

export interface BoardManagerResult {
  stop: () => Promise<void>
}

export interface SignerState {
  privateKey: string
}

export interface ArchivedThread {
  archivedTimestamp: number
}

export interface FileLock {
  lockPath: string
  release: () => void
}

export interface BoardManagerState {
  signers: Record<string, SignerState>
  archivedThreads: Record<string, ArchivedThread>
}

/** Per-board config entry in the multi-board config file */
export interface BoardConfig {
  address: string
  perPage?: number
  pages?: number
  bumpLimit?: number
  archivePurgeSeconds?: number
  moderationReasons?: ModerationReasons
}

/** Default settings applied to all boards unless overridden per-board */
export interface BoardDefaults {
  perPage?: number
  pages?: number
  bumpLimit?: number
  archivePurgeSeconds?: number
  moderationReasons?: ModerationReasons
}

/** Global config stored in global.json */
export interface GlobalConfig {
  rpcUrl?: string
  stateDir?: string
  defaults?: BoardDefaults
}

/** Top-level multi-board JSON config */
export interface MultiBoardConfig {
  rpcUrl?: string
  stateDir?: string
  defaults?: BoardDefaults
  boards: BoardConfig[]
}

/** Result of starting multi-board managers */
export interface MultiBoardResult {
  boardManagers: Map<string, BoardManagerResult>
  errors: Map<string, Error>
  stop: () => Promise<void>
}
