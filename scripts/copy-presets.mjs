import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const sourceDir = join(projectRoot, 'src', 'presets')
const destinationDir = join(projectRoot, 'dist', 'presets')

if (!existsSync(sourceDir)) {
  process.exit(0)
}

mkdirSync(destinationDir, { recursive: true })
cpSync(sourceDir, destinationDir, { recursive: true, force: true })
