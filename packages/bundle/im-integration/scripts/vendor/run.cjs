'use strict'

const { spawnSync } = require('node:child_process')

const bin = process.env.DSH_IM_CLI_BIN
if (typeof bin !== 'string' || bin.length === 0) {
  process.stderr.write('DSH_IM_CLI_BIN is unset\n')
  process.exit(1)
}

const child = spawnSync(bin, process.argv.slice(2), {
  stdio: 'inherit',
  env: process.env,
  windowsHide: true,
})
if (child.error) {
  process.stderr.write(`${child.error.message}\n`)
  process.exit(1)
}
process.exit(child.status === null ? 1 : child.status)
