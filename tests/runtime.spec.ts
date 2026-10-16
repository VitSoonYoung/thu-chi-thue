import { test, expect } from '@playwright/test'
import { execFile, spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
const exec = promisify(execFile)
test('occupied port is explicit and private network requires unlock', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'thuchithue-runtime-'))
  const config = join(dir, 'config.json')
  await writeFile(config, JSON.stringify({ listen: '0.0.0.0:3210', access_password: 'runtime test password', session_hours: 1 }))
  try {
    await expect(
      exec(resolve('bin/thuchithue'), [
        '--config', config,
        '--headless',
        '--data-dir',
        dir,
        '--listen',
        '127.0.0.1:8081',
      ]),
    ).rejects.toThrow(/choose another port/)
    const child = spawn(resolve('bin/thuchithue'), ['--config', config, '--quiet=false', '--data-dir', dir, '--listen', '0.0.0.0:0'])
    try {
      const port = await new Promise<string>((res, reject) => {
        child.stderr.on('data', data => {
          const found = data.toString().match(/Listening at http:\/\/\[::\]:(\d+)|Listening at http:\/\/0\.0\.0\.0:(\d+)/)
          if (found) res(found[1] || found[2])
        })
        child.once('error', reject)
        child.once('exit', code => reject(new Error('Server exited: ' + code)))
      })
      expect((await fetch('http://127.0.0.1:' + port + '/api/state')).status).toBe(401)
    } finally {
      const ended = new Promise(resolve => child.once('exit', resolve))
      child.kill('SIGTERM')
      await ended
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
test('headless server optionally announces its URL and shuts down cleanly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'thuchithue-headless-'))
  const config = join(dir, 'config.json')
  await writeFile(config, JSON.stringify({ listen: '127.0.0.1:3210', access_password: 'runtime test password', session_hours: 1 }))
  const child = spawn(resolve('bin/thuchithue'), [
    '--config', config,
    '--headless',
    '--quiet=false',
    '--data-dir',
    dir,
    '--listen',
    '127.0.0.1:0',
  ])
  try {
    const url = await new Promise<string>((res, reject) => {
      let output = ''
      child.stderr.on('data', (data) => {
        output += data.toString()
        const found = output.match(/Listening at (http:\/\/127\.0\.0\.1:\d+)/)
        if (found) res(found[1])
      })
      child.once('error', reject)
    })
    expect((await fetch(url + '/api/state')).status).toBe(401)
    const ended = new Promise((resolve) => child.once('exit', resolve))
    child.kill('SIGTERM')
    expect(await ended).toBe(0)
  } finally {
    child.kill('SIGTERM')
    await rm(dir, { recursive: true, force: true })
  }
})
