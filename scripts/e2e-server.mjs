import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const directory = await mkdtemp(join(tmpdir(), 'thuchithue-e2e-'))
const config = join(directory, 'config.json')
await writeFile(config, JSON.stringify({ listen: '127.0.0.1:8081', access_password: 'browser test password', session_hours: 1, passkey_rp_id: 'localhost', passkey_origins: ['http://localhost:8081'] }))
const child = spawn(
  resolve('bin/thuchithue'),
  ['--config', config, '--headless', '--listen', '127.0.0.1:8081', '--data-dir', directory],
  { stdio: 'inherit' },
)
let stopping = false
function stop() {
  if (!stopping) {
    stopping = true
    child.kill('SIGTERM')
  }
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
child.on('error', async (error) => {
  console.error(error.message)
  await rm(directory, { recursive: true, force: true })
  process.exit(1)
})
child.on('exit', async (code) => {
  await rm(directory, { recursive: true, force: true })
  process.exit(code || 0)
})
