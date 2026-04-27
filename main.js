const { app, BrowserWindow, ipcMain, shell, Tray, Menu, globalShortcut, nativeImage } = require('electron')
const path  = require('path')
const fs    = require('fs')
const https = require('https')
const http  = require('http')
const { spawn } = require('child_process')

let win
let tray

const APP_ROOT = app.isPackaged ? path.dirname(app.getPath('exe')) : __dirname
const isWin    = process.platform === 'win32'
const ytdlBin  = isWin ? 'yt-dlp.exe' : 'yt-dlp'
const ytdlUrl  = isWin
  ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp'

// ── Cache ──────────────────────────────────────────────────────
// Two layers:
//   1. RAM cache  — instant, lives for this session
//   2. Disk cache — survives restarts, 6hr TTL
const CACHE_FILE   = path.join(app.getPath('userData'), 'audio-cache.json')
const CACHE_TTL_MS = 6 * 60 * 60 * 1000   // 6 hours (YouTube CDN ~6hr)

let diskCache = {}   // videoId → { url, expires, title, author, thumb, duration }
let ramCache  = {}   // videoId → same (lives only this session, no expiry needed)

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      diskCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
      const now = Date.now()
      let dirty = false
      for (const k of Object.keys(diskCache)) {
        if (diskCache[k].expires < now) { delete diskCache[k]; dirty = true }
      }
      if (dirty) saveCache()
      // Warm the RAM cache from disk on startup — zero disk reads later
      Object.assign(ramCache, diskCache)
    }
  } catch(e) { diskCache = {}; ramCache = {} }
}

function saveCache() {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(diskCache), 'utf8') } catch(e) {}
}

function getCached(videoId) {
  // RAM first (instant)
  if (ramCache[videoId]) {
    const e = ramCache[videoId]
    if (!e.expires || e.expires > Date.now()) return e
    delete ramCache[videoId]; delete diskCache[videoId]; saveCache(); return null
  }
  return null
}

function setCache(videoId, data) {
  const entry = { ...data, expires: Date.now() + CACHE_TTL_MS }
  ramCache[videoId]  = entry   // RAM — immediate
  diskCache[videoId] = entry   // Disk — async write (don't block)
  setImmediate(saveCache)
}

function getCacheStats() {
  const now   = Date.now()
  const valid = Object.values(diskCache).filter(e => e.expires > now).length
  return { total: valid, sizeKb: Math.round(JSON.stringify(diskCache).length / 1024) }
}

function clearCache() {
  diskCache = {}; ramCache = {}
  try { if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE) } catch(e) {}
}

// ── yt-dlp — find & cache binary path ─────────────────────────
function getUserDataBin() {
  return path.join(app.getPath('userData'), ytdlBin)
}

function getCandidates() {
  const loc  = process.env.LOCALAPPDATA || ''
  const home = process.env.USERPROFILE  || process.env.HOME || ''
  return [
    getUserDataBin(),
    path.join(__dirname, 'yt-dlp.exe'),
    path.join(__dirname, 'yt-dlp'),
    'yt-dlp', 'yt-dlp.exe',
    path.join(loc, 'Microsoft', 'WinGet', 'Links', 'yt-dlp.exe'),
    path.join(loc, 'Programs', 'Python', 'Python312', 'Scripts', 'yt-dlp.exe'),
    path.join(loc, 'Programs', 'Python', 'Python311', 'Scripts', 'yt-dlp.exe'),
    path.join(loc, 'Programs', 'Python', 'Python310', 'Scripts', 'yt-dlp.exe'),
    path.join(home, 'scoop', 'shims', 'yt-dlp.exe'),
    path.join(home, '.local', 'bin', 'yt-dlp'),
    '/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp', '/opt/homebrew/bin/yt-dlp',
  ]
}

function runBin(bin, args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let stdout = '', stderr = ''
    const proc = spawn(bin, args, { shell: false, windowsHide: true })
    proc.stdout.on('data', d => { stdout += d.toString() })
    proc.stderr.on('data', d => { stderr += d.toString() })
    proc.on('error', reject)
    proc.on('close', code => {
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(stderr.trim() || `exit ${code}`))
    })
    const timer = setTimeout(() => {
      try { proc.kill() } catch(e) {}
      reject(new Error('Timed out'))
    }, timeoutMs)
    proc.on('close', () => clearTimeout(timer))
  })
}

// Binary path cached for the whole session — never re-scanned after first find
let _ytBin = null
let _ytBinChecked = false

async function findYtDlp() {
  // Already found this session — just return it (no disk/process check)
  if (_ytBin) return { bin: _ytBin, version: '(cached)' }

  // First time — scan all candidates
  for (const b of getCandidates()) {
    try {
      const ver = await runBin(b, ['--version'], 4000)
      if (ver) { _ytBin = b; _ytBinChecked = true; return { bin: b, version: ver.trim() } }
    } catch(e) {}
  }
  return null
}

// ── FAST audio resolution ──────────────────────────────────────
// Key optimisation: single yt-dlp call using --print to get
// audio URL + all metadata in one pass instead of two processes.
// This cuts resolution time roughly in half.
async function resolveAudio(url, videoId) {
  // Layer 1: RAM cache — returns instantly with no I/O
  if (videoId) {
    const cached = getCached(videoId)
    if (cached) {
      return { ok: true, fromCache: true, audioUrl: cached.url,
        title: cached.title, author: cached.author,
        thumb: cached.thumb, duration: cached.duration }
    }
  }

  const found = await findYtDlp()
  if (!found) throw new Error('NO_YTDLP')
  const { bin } = found

  // Single yt-dlp call with --print for each field we need.
  // --print is much faster than --dump-json because it doesn't
  // fetch or encode the full info dict — just the fields requested.
  // Output format: line1=audioUrl, line2=title, line3=uploader,
  //                line4=thumbnail, line5=duration, line6=id
  const output = await runBin(bin, [
    '--no-playlist',
    '--no-warnings',
    '--no-check-certificate',
    '--format', 'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio/best',
    '--print', '%(url)s',        // line 1 — direct audio URL
    '--print', '%(title)s',      // line 2
    '--print', '%(uploader)s',   // line 3
    '--print', '%(thumbnail)s',  // line 4
    '--print', '%(duration)s',   // line 5
    '--print', '%(id)s',         // line 6
    url,
  ], 30000)

  const lines = output.split('\n').map(l => l.trim())
  const [audioUrl, title, uploader, thumb, durStr, id] = lines

  if (!audioUrl || !audioUrl.startsWith('http')) {
    throw new Error('No playable URL returned by yt-dlp')
  }

  const result = {
    ok:       true,
    fromCache: false,
    audioUrl,
    title:    title    || 'Unknown Title',
    author:   uploader || 'Unknown Artist',
    thumb:    (thumb && thumb !== 'NA') ? thumb : null,
    duration: parseInt(durStr) || 0,
  }

  // Cache it for next time
  const vid = videoId || id
  if (vid) setCache(vid, {
    url: audioUrl, title: result.title, author: result.author,
    thumb: result.thumb, duration: result.duration,
  })

  return result
}

// ── Pre-fetch next track silently ─────────────────────────────
// Runs in background after current track starts playing.
// By the time user hits Next, the URL is already cached in RAM.
const _prefetchQueue = new Set()  // prevent duplicate concurrent fetches

async function prefetchTrack(url, videoId) {
  if (!videoId) return { ok: false }
  if (getCached(videoId)) return { ok: true, alreadyCached: true }
  if (_prefetchQueue.has(videoId)) return { ok: true, fetching: true }
  _prefetchQueue.add(videoId)
  try {
    await resolveAudio(url, videoId)
    return { ok: true }
  } catch(e) {
    return { ok: false, error: e.message }
  } finally {
    _prefetchQueue.delete(videoId)
  }
}

// ── Search ─────────────────────────────────────────────────────
async function searchYouTube(query) {
  const found = await findYtDlp()
  if (!found) throw new Error('NO_YTDLP')
  const results = await runBin(found.bin, [
    '--dump-json', '--flat-playlist', '--no-warnings', '--no-check-certificate',
    'ytsearch12:' + query,
  ])
  return results.split('\n')
    .filter(l => l.trim().startsWith('{'))
    .map(l => { try { return JSON.parse(l) } catch(e) { return null } })
    .filter(Boolean)
    .map(item => ({
      videoId:  item.id || '',
      title:    item.title || 'Unknown',
      author:   item.uploader || item.channel || item.artist || '',
      duration: item.duration || 0,
      thumb:    item.thumbnail || (item.id ? `https://img.youtube.com/vi/${item.id}/mqdefault.jpg` : null),
      url:      item.url || (item.id ? `https://www.youtube.com/watch?v=${item.id}` : ''),
    }))
    .filter(i => i.videoId && i.url)
}

// ── Download yt-dlp ────────────────────────────────────────────
function downloadYtDlp(onProgress) {
  return new Promise((resolve, reject) => {
    const dest = getUserDataBin()
    const tmp  = dest + '.tmp'
    const dir  = path.dirname(dest)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const file = fs.createWriteStream(tmp)
    onProgress({ status: 'connecting' })
    function doRequest(url, redirects) {
      if (redirects > 8) { reject(new Error('Too many redirects')); return }
      const mod = url.startsWith('https') ? https : http
      mod.get(url, { headers: { 'User-Agent': 'Nawfy/1.0' } }, res => {
        if ([301, 302, 307].includes(res.statusCode)) { doRequest(res.headers.location, redirects + 1); return }
        if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return }
        const total = parseInt(res.headers['content-length'] || '0')
        let downloaded = 0
        res.on('data', chunk => {
          downloaded += chunk.length
          if (total) onProgress({ status: 'downloading', pct: Math.round(downloaded / total * 100) })
        })
        res.pipe(file)
        file.on('finish', () => {
          file.close(() => {
            try { if (!isWin) fs.chmodSync(tmp, 0o755) } catch(e) {}
            try { fs.renameSync(tmp, dest) } catch(e) { fs.copyFileSync(tmp, dest); fs.unlinkSync(tmp) }
            _ytBin = null  // force re-validate after download
            resolve(dest)
          })
        })
        file.on('error', err => { try { fs.unlinkSync(tmp) } catch(e) {}; reject(err) })
      }).on('error', reject)
    }
    doRequest(ytdlUrl, 0)
  })
}

async function updateYtDlp() {
  const found = await findYtDlp()
  if (!found) throw new Error('yt-dlp not installed')
  try {
    await runBin(found.bin, ['-U'], 60000)
    _ytBin = null
    const refound = await findYtDlp()
    return { ok: true, version: refound?.version || 'updated' }
  } catch(e) {
    await downloadYtDlp(p => win?.webContents.send('ytdlp-progress', p))
    _ytBin = null
    const refound = await findYtDlp()
    return { ok: true, version: refound?.version || 'updated' }
  }
}

// ── Tray ───────────────────────────────────────────────────────
function createTray() {
  const iconFile = isWin ? 'icon.ico' : 'icon.png'
  const iconPath = path.join(__dirname, 'assets', iconFile)
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty()
  tray = new Tray(icon)
  tray.setToolTip('Nawfy Music Player')
  updateTrayMenu()
  tray.on('click', () => { if (win) { win.isVisible() ? win.focus() : win.show() } })
}

function updateTrayMenu(nowPlaying = null) {
  if (!tray) return
  const menu = Menu.buildFromTemplate([
    { label: 'Nawfy', enabled: false },
    { type: 'separator' },
    nowPlaying
      ? { label: `♪ ${nowPlaying.slice(0, 40)}`, enabled: false }
      : { label: 'No track playing', enabled: false },
    { type: 'separator' },
    { label: '⏮ Previous',    click: () => win?.webContents.send('tray-prev') },
    { label: '⏯ Play/Pause',  click: () => win?.webContents.send('tray-playpause') },
    { label: '⏭ Next',        click: () => win?.webContents.send('tray-next') },
    { type: 'separator' },
    { label: '🪟 Show Window', click: () => { win?.show(); win?.focus() } },
    { label: '✕ Quit Nawfy',  click: () => { app.isQuitting = true; app.quit() } },
  ])
  tray.setContextMenu(menu)
}

// ── Global media keys ──────────────────────────────────────────
function registerMediaKeys() {
  const keys = [
    ['MediaPlayPause',    'media-playpause'],
    ['MediaNextTrack',    'media-next'],
    ['MediaPreviousTrack','media-prev'],
    ['MediaStop',         'media-stop'],
  ]
  for (const [key, ch] of keys) {
    try { globalShortcut.register(key, () => win?.webContents.send(ch)) } catch(e) {}
  }
}

// ── Window ─────────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 1160, height: 760,
    minWidth: 900, minHeight: 600,
    frame: false,
    backgroundColor: '#050408',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      webSecurity:      false,
    },
    icon: path.join(__dirname, 'assets', isWin ? 'icon.ico' : 'icon.png'),
    show: false,
  })

  // Spoof headers so YouTube CDN accepts audio requests
  win.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: ['*://*.googlevideo.com/*', '*://*.youtube.com/*'] },
    (details, callback) => {
      details.requestHeaders['Referer']    = 'https://www.youtube.com/'
      details.requestHeaders['Origin']     = 'https://www.youtube.com'
      details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'
      callback({ requestHeaders: details.requestHeaders })
    }
  )

  win.loadFile(path.join(__dirname, 'src', 'index.html'))
  win.once('ready-to-show', () => win.show())

  win.on('close', e => {
    if (!app.isQuitting) {
      e.preventDefault(); win.hide()
      tray?.displayBalloon?.({ title: 'Nawfy', content: 'Still running in the system tray', noSound: true })
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url); return { action: 'deny' }
  })
}

// ── Boot ───────────────────────────────────────────────────────
app.whenReady().then(() => {
  loadCache()
  createWindow()
  createTray()
  registerMediaKeys()

  // Warm up yt-dlp binary path in background so first play has no delay
  findYtDlp().then(found => {
    if (found) console.log('[nawfy] yt-dlp ready:', found.bin)
  })
})

app.on('before-quit', () => { app.isQuitting = true })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

// ── IPC ────────────────────────────────────────────────────────
ipcMain.on('win-minimize', () => win?.minimize())
ipcMain.on('win-maximize', () => { if (!win) return; win.isMaximized() ? win.unmaximize() : win.maximize() })
ipcMain.on('win-close',    () => win?.hide())
ipcMain.on('win-quit',     () => { app.isQuitting = true; app.quit() })
ipcMain.on('tray-update',  (_, title) => updateTrayMenu(title))

ipcMain.handle('open-external',  (_, url) => shell.openExternal(url))

ipcMain.handle('check-setup', async () => {
  const found = await findYtDlp()
  return { ok: !!found, version: found?.version || null }
})

ipcMain.handle('download-ytdlp', async () => {
  try {
    await downloadYtDlp(p => win?.webContents.send('ytdlp-progress', p))
    const found = await findYtDlp()
    return { ok: true, version: found?.version || 'installed' }
  } catch(e) { return { ok: false, error: e.message } }
})

ipcMain.handle('update-ytdlp', async () => {
  try   { return await updateYtDlp() }
  catch (e) { return { ok: false, error: e.message } }
})

ipcMain.handle('resolve-audio', async (_, url, videoId) => {
  try   { return await resolveAudio(url, videoId) }
  catch (e) { return { ok: false, error: e.message } }
})

ipcMain.handle('prefetch-track', async (_, url, videoId) => {
  return await prefetchTrack(url, videoId)
})

ipcMain.handle('search-youtube', async (_, query) => {
  try   { return { ok: true, results: await searchYouTube(query) } }
  catch (e) { return { ok: false, error: e.message } }
})

ipcMain.handle('get-cache-stats', () => getCacheStats())
ipcMain.handle('clear-cache',     () => { clearCache(); return { ok: true } })
ipcMain.handle('get-cached-ids',  () => {
  const now = Date.now()
  return Object.keys(ramCache).filter(k => !ramCache[k].expires || ramCache[k].expires > now)
})

// ── File import/export ─────────────────────────────────────────
const { dialog } = require('electron')

ipcMain.handle('save-file', async (_, filename, data) => {
  const { filePath } = await dialog.showSaveDialog(win, {
    defaultPath: filename,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (!filePath) return { ok: false, cancelled: true }
  try {
    fs.writeFileSync(filePath, data, 'utf8')
    return { ok: true }
  } catch(e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('open-file', async () => {
  const { filePaths } = await dialog.showOpenDialog(win, {
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  })
  if (!filePaths || !filePaths[0]) return { ok: false, cancelled: true }
  try {
    const data = fs.readFileSync(filePaths[0], 'utf8')
    return { ok: true, data }
  } catch(e) {
    return { ok: false, error: e.message }
  }
})

// ── Download audio to disk ─────────────────────────────────────
ipcMain.handle('download-audio', async (_, url, videoId, filename) => {
  try {
    const found = await findYtDlp()
    if (!found) return { ok: false, error: 'NO_YTDLP' }

    const { filePath } = await dialog.showSaveDialog(win, {
      defaultPath: filename || 'track.m4a',
      filters: [
        { name: 'Audio', extensions: ['m4a', 'mp3', 'webm', 'opus'] },
        { name: 'All Files', extensions: ['*'] }
      ],
    })
    if (!filePath) return { ok: false, cancelled: true }

    // Download with best audio format
    await runBin(found.bin, [
      '--format', 'bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio',
      '--output', filePath,
      '--no-playlist', '--no-warnings', '--no-check-certificate',
      url,
    ], 120000)

    return { ok: true, path: filePath }
  } catch(e) {
    return { ok: false, error: e.message }
  }
})

// ── Mini player window ─────────────────────────────────────────
let miniWin = null

ipcMain.handle('open-mini-player', async (_, trackData) => {
  if (miniWin && !miniWin.isDestroyed()) {
    miniWin.focus()
    miniWin.webContents.send('mini-track-update', trackData)
    return { ok: true }
  }

  miniWin = new BrowserWindow({
    width: 320, height: 110,
    x: 20, y: 20,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-mini.js'),
      contextIsolation: true,
    },
    skipTaskbar: true,
  })

  miniWin.loadFile(path.join(__dirname, 'src', 'mini.html'))
  miniWin.once('ready-to-show', () => {
    miniWin.show()
    miniWin.webContents.send('mini-track-update', trackData)
  })
  miniWin.on('closed', () => { miniWin = null; win?.webContents.send('mini-closed') })
  return { ok: true }
})

ipcMain.on('mini-playpause', () => win?.webContents.send('media-playpause'))
ipcMain.on('mini-next',      () => win?.webContents.send('media-next'))
ipcMain.on('mini-prev',      () => win?.webContents.send('media-prev'))
ipcMain.on('mini-close',     () => { miniWin?.close() })
ipcMain.on('mini-show-main', () => { win?.show(); win?.focus() })

ipcMain.handle('update-mini-player', (_, trackData) => {
  miniWin?.webContents.send('mini-track-update', trackData)
  return { ok: true }
})

ipcMain.handle('close-mini-player', () => {
  miniWin?.close()
  return { ok: true }
})
