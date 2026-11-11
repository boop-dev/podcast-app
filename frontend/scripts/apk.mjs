// One-command APK build (and optional USB install).
//   npm run apk            -> builds android/app/build/outputs/apk/debug/app-debug.apk
//   npm run install:phone  -> builds, then installs over USB with adb (keeps app data)
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const android = join(root, 'android')
const win = process.platform === 'win32'
const local = process.env.LOCALAPPDATA || ''

// Capacitor 8 needs JDK 21 and Gradle 8 can't run on JDK 25. Use a JDK 21 (set JAVA_HOME_FOR_GRADLE to override).
const jbrs = [
  process.env.JAVA_HOME_FOR_GRADLE,
  join(process.env.USERPROFILE || process.env.HOME || '', '.jdks', 'jbr-21.0.11'),
  'C:/Program Files/Android/Android Studio1/jbr',
  'C:/Program Files/Android/Android Studio/jbr',
  '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
].filter(Boolean)
const jbr = jbrs.find((p) => existsSync(p))
const env = { ...process.env }
if (jbr) env.JAVA_HOME = jbr

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: win, env, cwd: root, ...opts })
  if (r.status !== 0) {
    console.error(`\nFailed: ${cmd} ${args.join(' ')}`)
    process.exit(r.status || 1)
  }
}

run('npx', ['vite', 'build'])
run('npx', ['cap', 'sync', 'android'])
run('"' + join(android, win ? 'gradlew.bat' : 'gradlew') + '"', ['assembleDebug'], { cwd: android })

const apk = join(android, 'app/build/outputs/apk/debug/app-debug.apk')
console.log(`\nAPK ready: ${apk}`)

if (process.argv.includes('--install')) {
  const sdkAdb = join(local, 'Android/Sdk/platform-tools', win ? 'adb.exe' : 'adb')
  const adb = existsSync(sdkAdb) ? `"${sdkAdb}"` : 'adb'
  run(adb, ['install', '-r', `"${apk}"`])
  run(adb, ['shell', 'monkey', '-p', 'dev.boop.podcastapp', '-c', 'android.intent.category.LAUNCHER', '1'])
  console.log('Installed and launched.')
}
