# 5chan Board CLI

An ESM TypeScript npm package that implements 4chan-style thread auto-archiving and purging for plebbit-js subplebbits. Uses plebbit-js's public API (`plebbit.createCommentModeration()`) — **no plebbit-js modifications required**.

> **Node.js only.** This is a Node.js-only ESM package — it requires a running Plebbit RPC server and uses Node.js APIs (`fs`, `node:util`). Start [bitsocial-cli](https://github.com/bitsocialhq/bitsocial-cli) first to get a Plebbit RPC server running, then point this package at it. Apps using it as a library (like 5chan) must run the archiver in a Node.js environment, not in the browser.

Works two ways:
1. **CLI** — unified `5chan` command with subcommands for starting archivers and managing boards
2. **Library** — imported by 5chan (web UI) as a dependency

## CLI Usage

The `5chan` binary provides subcommands for managing boards and running archivers.

### Starting the archiver

```bash
5chan start [--config PATH]
```

- Reads the config file at `~/.config/5chan/config.json` by default, or from `--config PATH`
- Starts one archiver per configured board
- Watches the config file for changes and auto-starts/stops archivers (hot-reload)
- Handles `SIGINT`/`SIGTERM` for graceful shutdown

### Managing boards

Add, list, and remove boards from the config file:

```bash
# Add a board (validates it exists on the RPC node)
5chan board add <address> [--rpc-url URL] [--per-page N] [--pages N] [--bump-limit N] [--archive-purge-seconds N]

# List configured boards
5chan board list

# Remove a board
5chan board remove <address>
```

- `board add` validates the address against the Plebbit RPC node before adding
- `--rpc-url` defaults to `PLEBBIT_RPC_WS_URL` env var, then `ws://localhost:9138`
- Per-board settings (`--per-page`, `--pages`, `--bump-limit`, `--archive-purge-seconds`) are optional overrides

### Config File Format

The config file (`~/.config/5chan/config.json`) is managed via `5chan board add/remove` or manual editing:

```json
{
  "rpcUrl": "ws://localhost:9138",
  "stateDir": "/data/5chan-archiver",
  "defaults": {
    "perPage": 15,
    "pages": 10,
    "bumpLimit": 300,
    "archivePurgeSeconds": 172800
  },
  "boards": [
    { "address": "random.eth" },
    { "address": "tech.eth", "bumpLimit": 500 },
    { "address": "flash.eth", "perPage": 30, "pages": 1 }
  ]
}
```

**Minimal config:** `{ "boards": [{ "address": "my-board.eth" }] }`

All fields except `boards[].address` are optional:
- `rpcUrl` — falls back to `PLEBBIT_RPC_WS_URL` env var, then `ws://localhost:9138`
- `stateDir` — falls back to OS data directory
- `defaults` — applied to all boards unless overridden per-board
- Per-board fields (`perPage`, `pages`, `bumpLimit`, `archivePurgeSeconds`) override `defaults`

## Docker

Pre-built images are published to GitHub Container Registry after each release:

```
ghcr.io/plebbit/5chan-board-cli:latest
```

### Docker Compose (recommended)

#### Full stack (with bitsocial-cli)

If you **don't** already have [bitsocial-cli](https://github.com/bitsocialhq/bitsocial-cli) running, use the full stack compose file which boots both bitsocial-cli (Plebbit RPC server) and 5chan together.:

```bash
cp docker-compose.example.yml docker-compose.yml
# Create /data/config.json with your boards (see Config File Format above)
docker compose up -d
```

See [`docker-compose.example.yml`](docker-compose.example.yml) for the full configuration.

#### Standalone (bitsocial-cli already running)

If you **already** have bitsocial-cli running separately (on the host, in another compose stack, etc.), use the standalone compose file which only runs 5chan:

```bash
cp docker-compose.standalone.example.yml docker-compose.yml
# Edit PLEBBIT_RPC_WS_URL in docker-compose.yml to point at your running bitsocial-cli
# Create /data/config.json with your boards (see Config File Format above)
docker compose up -d
```

Set `PLEBBIT_RPC_WS_URL` to the address of your existing instance:

- **bitsocial-cli on the host (no container):** Use `ws://host.docker.internal:9138`. The example compose file includes `extra_hosts: ["host.docker.internal:host-gateway"]` so this works on Linux, macOS, and Windows.
- **bitsocial-cli in another Docker container/network:** Use the container or service name, e.g. `ws://bitsocial:9138`, and make sure both containers share the same Docker network.

See [`docker-compose.standalone.example.yml`](docker-compose.standalone.example.yml) for the configuration.

### Running commands inside Docker

Use `docker compose exec` to run `5chan` CLI commands inside the running container:

```bash
# Add a board
docker compose exec 5chan 5chan board add random.eth

# List configured boards
docker compose exec 5chan 5chan board list

# Remove a board
docker compose exec 5chan 5chan board remove random.eth
```

The container auto-reloads when `/data/config.json` changes, so boards added via `5chan board add` take effect immediately without restarting.

### Build locally

```bash
docker build -t 5chan-board-cli .
docker run -d -v /path/to/data:/data 5chan-board-cli
```

### Data paths

| Container path | Description |
|---|---|
| `/data/config.json` | Board configuration (create before first run, or use `5chan board add`) |
| `/data/5chan-archiver/` | Per-board state files (auto-created) |

## systemd Service Example

```ini
[Unit]
Description=5chan Board Archiver
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/node /opt/5chan-archiver/bin/run.js start --config /etc/5chan-archiver/config.json
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

## Config Hot-Reload

`5chan start` watches the config file using `fs.watch()` with a 200ms debounce. When the file changes:

1. Loads and validates the new config
2. Diffs old vs new boards
3. Stops archivers for removed boards
4. Starts archivers for added boards
5. Logs the delta: `config reloaded: +N added, -N removed, M running`

This means you can add or remove boards while the archiver is running — either by editing the config file directly or by running `5chan board add/remove` in another terminal.

## File Locking

Each archiver acquires a PID-based lock file (`{statePath}.lock`) to prevent concurrent archivers on the same board. On startup:

1. Attempts to create lock file exclusively (`wx` flag)
2. If lock exists, reads the PID and checks if it's still alive (`process.kill(pid, 0)`)
3. If alive — throws `Another archiver (PID N) is already running`
4. If stale — removes the old lock and retries

The lock is released when the archiver stops.

## Author-Deleted Comment Purging

The archiver detects comments and replies that were deleted by their author (where `comment.deleted === true`) and purges them via `createCommentModeration({ commentModeration: { purged: true } })`. Once purged, the comment is removed from the subplebbit and won't appear in future listings. If a purge hasn't been processed yet, the next cycle may re-publish a redundant purge moderation, which is a harmless no-op.

## Auto Mod Signer Management

On startup for each subplebbit (using the internally-created Plebbit instance):

1. Check state JSON for a signer private key for this subplebbit address
2. If none exists, create one via `plebbit.createSigner()` and save to state JSON
3. Check `subplebbit.roles` for the signer's address
4. If not a mod, auto-add via `subplebbit.edit()` (works because we run on LocalSubplebbit or RpcLocalSubplebbit — we own the sub)

Logged via `plebbit-logger` when creating signer or adding mod role.

## State Persistence

State is stored as one JSON file per subplebbit in the state directory (via `env-paths`: `~/.local/share/5chan-archiver/5chan_archiver_states/{address}.json`) or a custom directory via `stateDir` in the config.

```json
{
  "signers": {
    "<subplebbitAddress>": { "privateKey": "..." }
  },
  "archivedThreads": {
    "<commentCid>": { "archivedTimestamp": 1234567890 }
  }
}
```

- **`signers`**: maps subplebbit address → mod signer private key (auto-created if missing)
- **`archivedThreads`**: maps comment CID → archive metadata (entries removed on purge)
- State writes use atomic temp-then-rename to prevent corruption
- Loaded on startup, written on archive, entries removed on purge

## Cold Start

The script may start long after the board has been running. On first run, many threads may need locking/purging at once. No rate limiting is needed — same-node publishing has no pubsub overhead. The first cycle may be heavier; steady-state handles a few threads per update.

## Idempotency

Before archiving, checks the thread's `archived` property. Skips if already archived (plebbit-js throws on duplicate moderation actions).

## Logging

Uses `plebbit-logger` (same logger as the plebbit-js ecosystem). Key events logged:

- Archiver start/stop
- Threads archived (with CID and reason: capacity vs bump limit)
- Threads purged
- Author-deleted comments purged
- Config hot-reload events
- Mod role auto-added
- Errors

## Library API

```ts
import { startArchiver } from '5chan-board-cli'

const archiver = await startArchiver({
  subplebbitAddress: 'my-board.eth',
  plebbitRpcUrl: 'ws://localhost:9138', // Plebbit RPC WebSocket URL
  stateDir: '/custom/state/dir',       // optional, defaults to OS data dir
  perPage: 15,    // optional, default 15
  pages: 10,      // optional, default 10
  bumpLimit: 300, // optional, default 300
  archivePurgeSeconds: 172800, // optional, default 172800 (48h)
})

// Later, to stop:
await archiver.stop()
```

- `plebbitRpcUrl` is the WebSocket URL of a running Plebbit RPC server (Plebbit instance is created and destroyed internally)
- `stateDir` is the directory for per-subplebbit state files (default: `~/.local/share/5chan-archiver/5chan_archiver_states/`)
- Returns `{ stop(): Promise<void> }` — stops the archiver, cleans up event listeners, and destroys the Plebbit instance

### Multi-Board Library API

```ts
import { loadMultiConfig, startMultiArchiver } from '5chan-board-cli'

const config = loadMultiConfig('archiver-config.json')
const result = await startMultiArchiver(config)

console.log(`Started: ${result.archivers.size}, Failed: ${result.errors.size}`)

// Graceful shutdown
await result.stop()
```

For config-watching with hot-reload (same behavior as `5chan start`):

```ts
import { loadConfig, startArchiverManager } from '5chan-board-cli'

const configPath = '/path/to/config.json'
const config = loadConfig(configPath)
const manager = await startArchiverManager(configPath, config)

// manager watches config file and auto-starts/stops archivers
// manager.archivers — Map of running archivers
// manager.errors — Map of failed archivers

await manager.stop()
```

### All Exports

```ts
// Core archiver
export { startArchiver } from '5chan-board-cli'

// Multi-board (static — no hot-reload)
export { loadMultiConfig, resolveArchiverOptions, startMultiArchiver } from '5chan-board-cli'

// Config management (for hot-reload and board commands)
export { loadConfig, saveConfig, addBoard, removeBoard, diffBoards } from '5chan-board-cli'

// Board validation
export { validateBoardAddress } from '5chan-board-cli'

// Archiver manager (hot-reload)
export { startArchiverManager } from '5chan-board-cli'

// State
export { defaultStateDir } from '5chan-board-cli'

// Types
export type {
  ArchiverOptions, ArchiverResult, BoardConfig, BoardDefaults,
  MultiArchiverConfig, MultiArchiverResult, ArchiverManager,
} from '5chan-board-cli'
```

## 4chan Board Behavior Reference

### Board capacity

Total thread capacity = `per_page × pages`. Both are **configurable per board**.

| Setting | Range | Description |
|---------|-------|-------------|
| `per_page` | 15–30 | Threads per index page (e.g., /b/ = 15, /v/ = 20, /f/ = 30) |
| `pages` | 1–10 | Number of index pages (e.g., /f/ = 1, most boards = 10) |

Capacity examples: /b/ = 150, /v/ = 200, /f/ = 30.

### Thread lifecycle

1. **New thread created** → sits at top of page 1
2. **Bumped by replies** → moves back to top of page 1
3. **Sinks gradually** as newer threads get replies
4. **Falls off last page** → archived (read-only, ~48h)
5. **Purged** → permanently deleted from 4chan's servers

### Bumping

A reply moves the thread to the top of page 1. This is equivalent to plebbit's **"active sort"**, which orders threads by `lastReplyTimestamp`.

### Bump limit

Configurable per board (300–500+). After N replies, new replies no longer bump the thread, but it still accepts replies until it falls off the last page.

Examples: /b/ = 300, /3/ = 310, /v/ = 500.

### Pinned (sticky) threads

Sit at top of page 1, exempt from thread limit and archiving. "Pinned" and "sticky" are the same thing.

### Archive vs purge

- **Archived** = locked/read-only, still visible for ~48 hours
- **Purged** = permanently deleted from 4chan's servers
- Not all boards have archives (`is_archived` flag in API)

### Third-party archives

External services (archive.4plebs.org, desuarchive.org) independently scrape and preserve threads before purge.

### Other per-board settings from 4chan API

`image_limit`, `max_filesize`, `max_comment_chars`, `cooldowns`, `spoilers`, `country_flags`, `user_ids`, `forced_anon`, etc.

## Differences from 4chan

| Behavior | 4chan | This module |
|----------|------|-------------|
| **Bump limit** | Threads past bump limit still accept replies — they just stop rising in the catalog | Threads are **archived** (no more replies) because plebbit-js has no "stop bumping without archiving" mechanism |
| **Sage** | Replying with `sage` in the email field prevents the thread from being bumped | Not supported — plebbit has no equivalent mechanism, so all replies bump the thread |
| **Image limit** | Per-thread image limit (e.g., 150 images on /b/) after which no more images can be posted | Not implemented — plebbit-js has its own file-size constraints but no per-thread image count limit |

## Plebbit-js Implementation

### Architecture

External module using plebbit-js's public API:

- No plebbit-js core modifications needed
- Uses `plebbit.createCommentModeration()` for both archiving and purging
- Listens to subplebbit `update` events to detect new posts
- Gets thread positions from `subplebbit.posts.pageCids.active`, or falls back to sorting preloaded pages by `lastReplyTimestamp` descending (then `postNumber`)

### Configurable settings

Uses 4chan field names for interoperability.

| Setting | Default | 4chan range | Description |
|---------|---------|-------------|-------------|
| `per_page` | 15 | 15–30 | Threads per index page |
| `pages` | 10 | 1–10 | Number of index pages |
| `bump_limit` | 300 | 300–500 | Max replies before thread is archived |
| `archive_purge_seconds` | 172800 (48h) | ~48h | Seconds before archived posts are purged (no 4chan equivalent, 4chan uses ~48h) |

**Max active threads** = `per_page × pages` (default: 150)

### API note

Cannot do `subplebbit.posts.getPage("active")`. Must either:

1. Use `subplebbit.posts.pageCids.active` to get the CID, then fetch that page
2. Or fall back to sorting preloaded pages by `lastReplyTimestamp` descending, then `postNumber` (approximates active sort without needing `pageCids.active`)

### Subplebbit record size constraint

The entire subplebbit IPFS record is capped at 1MB (`MAX_FILE_SIZE_BYTES_FOR_SUBPLEBBIT_IPFS`). `subplebbit.posts.pages.hot` is preloaded into the record with whatever space remains after the rest of the record (title, description, roles, challenges, etc.).

- If the preloaded page has **no `nextCid`**, it contains all posts — no pagination needed
- If `nextCid` **is present**, additional pages must be fetched via `subplebbit.posts.getPage({ cid: nextCid })`
- `subplebbit.posts.pageCids.active` provides the CID of the first active-sorted page, which is the sort order the archiver needs

Reference: `plebbit-js/src/subplebbit/subplebbit-client-manager.ts:38`, `plebbit-js/src/runtime/node/subplebbit/local-subplebbit.ts:714`

### Feature 1: Thread limit / auto-archive

- After each subplebbit update, determine thread positions in active sort
- Filter out pinned threads (they're exempt)
- Count non-pinned threads; any beyond position `per_page × pages` → archive via `createCommentModeration({ commentModeration: { archived: true } })`
- Archived threads are read-only (plebbit-js already enforces this)

### Feature 2: Bump limit

- Track reply counts for active threads
- When a thread reaches `bump_limit` replies → archive it via `createCommentModeration({ commentModeration: { archived: true } })`

### Feature 3: Delayed purge

- Track when threads were archived
- After `archive_purge_seconds` has elapsed since archiving → purge via `createCommentModeration({ commentModeration: { purged: true } })`

### Feature 4: Author-deleted comment purging

- On each update, scan comments and replies for `deleted === true`
- Purge via `createCommentModeration({ commentModeration: { purged: true } })`
- Duplicate purge moderations (if subplebbit hasn't processed prior purge yet) are harmless no-ops

### Module flow

```
1. Create Plebbit instance internally from the provided plebbitRpcUrl
2. Load state JSON; get or create signer for this subplebbit via plebbit.createSigner()
3. Get subplebbit (LocalSubplebbit or RpcLocalSubplebbit)
4. Check subplebbit.roles for signer address; if missing, subplebbit.edit() to add as mod
5. Acquire file lock to prevent concurrent archivers on same board
6. Call subplebbit.update()
7. On each 'update' event:
   a. Determine thread source (three scenarios):
      1. pageCids.active exists → fetch via getPage(), paginate via nextCid
      2. Only pages.hot exists → use preloaded page, sort by lastReplyTimestamp desc then postNumber
      3. Neither exists → no posts, return early
   b. Walk through pages to build full ordered list of threads
   c. Filter out pinned threads
   d. For each non-pinned thread beyond position (per_page * pages):
      - Skip if already archived
      - createCommentModeration({ archived: true }) and publish
      - Record archivedTimestamp in state file
   e. For each thread with replyCount >= bump_limit:
      - Skip if already archived
      - createCommentModeration({ archived: true }) and publish
      - Record archivedTimestamp in state file
   f. For each archived thread where (now - archivedAt) > archive_purge_seconds:
      - createCommentModeration({ purged: true }) and publish
      - Remove from state file
   g. For each author-deleted comment/reply:
      - createCommentModeration({ purged: true }) and publish
```

### Key plebbit-js APIs used

| API | Purpose |
|-----|---------|
| `plebbit.createCommentModeration()` | Archive and purge threads |
| `commentModeration.publish()` | Publish the moderation action |
| `subplebbit.posts.pageCids.active` | Get active sort page CID |
| `subplebbit.posts.pages.hot` | Preloaded first page (for calculating active sort) |
| `subplebbit.on('update', ...)` | Listen for new posts/updates |
| `page.nextCid` | Paginate through multi-page feeds |

### Key plebbit-js source files (reference only, not modified)

| File | Relevant code |
|------|--------------|
| `src/plebbit/plebbit.ts:806` | `createCommentModeration()` definition |
| `src/publications/comment-moderation/schema.ts:24` | ModeratorOptionsSchema with `archived`, `purged` fields |
| `src/runtime/node/subplebbit/local-subplebbit.ts:1658` | Existing archived check that blocks replies |
| `src/runtime/node/subplebbit/db-handler.ts:2567` | `queryPostsWithActiveScore()` — active sort CTE |
| `src/pages/util.ts` | Sort type definitions and scoring functions |
