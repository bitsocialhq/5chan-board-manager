#!/usr/bin/env node

import { parseArgs } from 'node:util'
import Plebbit from '@plebbit/plebbit-js'
import { startArchiver } from './archiver.js'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'per-page': { type: 'string' },
    'pages': { type: 'string' },
    'bump-limit': { type: 'string' },
    'archive-purge-seconds': { type: 'string' },
  },
})

const subplebbitAddress = positionals[0]
if (!subplebbitAddress) {
  console.error('Usage: 5chan-archiver <subplebbit-address> [--per-page N] [--pages N] [--bump-limit N] [--archive-purge-seconds N]')
  process.exit(1)
}

const perPage = parseInt(values['per-page'] ?? process.env.PER_PAGE ?? '15', 10)
const pages = parseInt(values['pages'] ?? process.env.PAGES ?? '10', 10)
const bumpLimit = parseInt(values['bump-limit'] ?? process.env.BUMP_LIMIT ?? '300', 10)
const archivePurgeSeconds = parseInt(values['archive-purge-seconds'] ?? process.env.ARCHIVE_PURGE_SECONDS ?? '172800', 10)

const plebbit = await Plebbit({
  dataPath: process.env.PLEBBIT_DATA_PATH,
})

const archiver = startArchiver({
  subplebbitAddress,
  plebbit,
  perPage,
  pages,
  bumpLimit,
  archivePurgeSeconds,
})

process.on('SIGINT', () => {
  archiver.stop()
  process.exit(0)
})

process.on('SIGTERM', () => {
  archiver.stop()
  process.exit(0)
})
