#!/usr/bin/env node
import { StorageError } from './scripts/storage.mjs'
import { ThreejsAssetPreparationError } from './scripts/prepare-threejs-assets.mjs'
import { saveThreejsProject } from './scripts/save-threejs.mjs'
import { ThreejsAssetRestoreError, assetRestoreDiagnostic } from './scripts/threejs-asset-restore.mjs'
try {
  if (process.argv.length !== 4 || process.argv[2] !== '--message') throw new Error('Three.js save usage: save-threejs.mjs --message "commit message"')
  console.log('__GAME_SAVE__ ' + JSON.stringify(await saveThreejsProject(process.cwd(), process.argv[3])))
} catch (error) {
  if (error instanceof ThreejsAssetRestoreError) console.error(JSON.stringify(assetRestoreDiagnostic(error)))
  if (error instanceof StorageError) console.error(JSON.stringify({ code: error.code, message: error.message, recovery: error.recovery, ...(error.httpStatus ? { httpStatus: error.httpStatus } : {}) }))
  if (error instanceof ThreejsAssetPreparationError) console.error(JSON.stringify({ code: 'threejs_assets_preparation_failed', message: error.message, recovery: 'Resolve the reported project configuration or staged edits, then retry save.' }))
  if (error instanceof Error && error.message.startsWith('Three.js save ')) console.error(error.message)
  console.error('Three.js save did not complete. Inspect asset synchronization and local Git before retrying. No push, checkpoint, or publication was performed.')
  process.exitCode = 1
}
