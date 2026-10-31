import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { syncAssets, listLocalAssets, tryAcquireExportLock, releaseExportLock } from './artifacts-lib.mjs'
import { prepareThreejsAssets } from './prepare-threejs-assets.mjs'
import { threejsAssetEntries, verifyThreejsAsset, restoreThreejsAssets } from './threejs-asset-restore.mjs'

const fail = message => new Error('Three.js save ' + message)

/** Like Godot save: synchronize and commit locally; the existing transport owns push/checkpoint. */
export async function saveThreejsProject(root, message, { synchronize = syncAssets } = {}) {
  if (typeof message !== 'string' || !message.trim() || message.includes('\0') || Buffer.byteLength(message) > 4096) throw fail('requires a nonempty commit message of at most 4096 bytes')
  root = realpathSync(root)
  if (existsSync(join(root, 'manus-webdev.json')) && !process.env.GIT_DIR) throw fail('requires webdev.manus_git for this Local First project')
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  if (!(pkg.dependencies?.three || pkg.devDependencies?.three)) throw fail('requires a Three.js project')
  const git = (args, options = {}) => execFileSync('git', args, { cwd: root, stdio: 'pipe', timeout: 60_000, maxBuffer: 8 * 1024 * 1024, ...options })
  if (realpathSync(git(['rev-parse', '--show-toplevel']).toString().trim()) !== root) throw fail('requires the project Git root')
  const { GIT_INDEX_FILE: suppliedIndex, ...normalGitEnv } = process.env
  const index = resolve(root, git(['rev-parse', '--git-path', 'index'], { env: normalGitEnv }).toString().trim())
  if (suppliedIndex && resolve(root, suppliedIndex) !== index) throw fail('requires the normal project Git index')
  for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply']) {
    if (existsSync(resolve(root, git(['rev-parse', '--git-path', marker]).toString().trim()))) throw fail('requires the current merge or rebase to finish first')
  }
  if (git(['diff', '--cached', '--name-only', '-z']).length) throw fail('found existing staged edits; commit or unstage them first')
  git(['var', 'GIT_AUTHOR_IDENT']); git(['var', 'GIT_COMMITTER_IDENT'])
  const head = git(['rev-parse', 'HEAD']).toString().trim()
  const branch = git(['symbolic-ref', '--quiet', 'HEAD']).toString().trim()
  const checkHead = () => {
    if (git(['rev-parse', 'HEAD']).toString().trim() !== head || git(['symbolic-ref', '--quiet', 'HEAD']).toString().trim() !== branch) throw fail('HEAD changed; inspect Git before retrying')
  }
  if (!tryAcquireExportLock(root)) throw fail('is busy; no commit was attempted')
  const temporary = join(dirname(index), '.threejs-save-index-' + randomUUID())
  const env = { ...process.env, GIT_INDEX_FILE: temporary }
  let fd, ownsIndexLock = false, commitAttempted = false
  try {
    fd = openSync(index + '.lock', 'wx', 0o600); ownsIndexLock = true
    // Check again after acquiring the index lock; no staged user work is discarded.
    if (git(['diff', '--cached', '--name-only', '-z']).length) throw fail('found staged edits while acquiring the index')
    git(['read-tree', head], { env })
    await restoreThreejsAssets(root)
    await synchronize(root, { engine: 'threejs', log: () => {} })
    await prepareThreejsAssets(root, { gitEnv: env })
    checkHead()
    git(['add', '-A', '--', '.'], { env })
    const entries = threejsAssetEntries(root)
    const managedPaths = new Set(entries.map(([rel]) => rel))
    const tracked = new Set(git(['ls-files', '-z'], { env }).toString().split('\0'))
    if (entries.some(([rel]) => tracked.has(rel))) throw fail('candidate still contains managed asset bytes')
    if (listLocalAssets(root).some(rel => !managedPaths.has(rel))) throw fail('new assets appeared during synchronization; retry after edits settle')
    for (const [rel, entry] of entries) await verifyThreejsAsset(join(root, rel), entry)
    if (existsSync(join(root, 'assets.lock.json')) && !git(['show', ':assets.lock.json'], { env }).equals(readFileSync(join(root, 'assets.lock.json')))) throw fail('manifest changed during staging')
    const tree = git(['write-tree'], { env }).toString().trim()
    checkHead()
    if (tree === git(['rev-parse', 'HEAD^{tree}']).toString().trim()) return { status: 'unchanged', sha: head, checkpoint: 'not_recorded' }
    commitAttempted = true
    git(['commit', '--file=-'], { env, input: message, timeout: 120_000 })
    const sha = git(['rev-parse', 'HEAD']).toString().trim()
    if (git(['symbolic-ref', '--quiet', 'HEAD']).toString().trim() !== branch || git(['show', '-s', '--format=%P', sha]).toString().trim() !== head || git(['rev-parse', `${sha}^{tree}`]).toString().trim() !== tree) throw fail('commit changed during saving; inspect before pushing')
    git(['read-tree', sha], { env })
    writeFileSync(fd, readFileSync(temporary)); closeSync(fd); fd = undefined
    renameSync(index + '.lock', index); ownsIndexLock = false
    return { status: 'committed', sha, checkpoint: 'not_recorded' }
  } catch (error) {
    if (commitAttempted) throw fail('commit was attempted; inspect local Git before pushing or retrying')
    throw error
  } finally {
    if (fd !== undefined) closeSync(fd)
    if (ownsIndexLock) rmSync(index + '.lock', { force: true })
    rmSync(temporary, { force: true }); rmSync(temporary + '.lock', { force: true })
    releaseExportLock(root)
  }
}
