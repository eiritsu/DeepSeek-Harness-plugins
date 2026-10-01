import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WorkspaceTypertGenerator } from '@deepseek-ai/dsh-typert-generator'

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageDir, '../../..')
const packageName = '@deepseek-ai/dsh-session-message-edit-resend'
const artifacts = new WorkspaceTypertGenerator(repositoryRoot).generate([packageName], ['host'])
const artifact = artifacts.find(candidate => candidate.package === packageName)
if (artifact === undefined || artifact.remote === undefined) {
  throw new Error(`${packageName} did not produce a Host Remote contribution`)
}

const output = resolve(packageDir, 'lib')
await mkdir(output, { recursive: true })
await Promise.all([
  writeFile(resolve(output, 'typert.host.js'), artifact.js),
  writeFile(resolve(output, 'typert.host.d.ts'), artifact.dts),
  writeFile(resolve(output, 'typert.remote-client.js'), artifact.remote.js),
  writeFile(resolve(output, 'typert.remote-client.d.ts'), artifact.remote.dts),
  writeFile(resolve(output, 'typert.remote-client.d.ts.map'), artifact.remote.dtsMap),
])
