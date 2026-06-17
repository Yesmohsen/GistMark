let backupTimer = null

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SCHEDULE_BACKUP') {
    scheduleBackup(msg.delayMs || 15000)
    sendResponse({ ok: true })
    return
  }
  if (msg.type === 'BACKUP_NOW') {
    performBackup()
      .then(result => sendResponse({ ok: true, result }))
      .catch(err => sendResponse({ ok: false, error: err.message }))
    return true
  }
  if (msg.type === 'RESTORE_FROM_GIST') {
    performRestore(msg.token, msg.gistId, (count, total) => {
      chrome.runtime.sendMessage({ type: 'RESTORE_PROGRESS', count, total }).catch(() => {})
    })
      .then(result => sendResponse({ ok: true, restored: result }))
      .catch(err => sendResponse({ ok: false, error: err.message }))
    return true
  }
})

function scheduleBackup(delayMs) {
  if (backupTimer) clearTimeout(backupTimer)
  const scheduledAt = Date.now() + delayMs
  chrome.storage.local.set({ pendingBackupAt: scheduledAt })

  backupTimer = setTimeout(async () => {
    backupTimer = null
    await chrome.storage.local.remove('pendingBackupAt')
    await performBackup()
  }, delayMs)
}

function compactBookmarks(tree) {
  const root = tree[0]
  const children = root.children || []
  const folderMap = { 'Bookmark Bar': 'ToolbarFolder', 'Other Bookmarks': 'MenuFolder', 'Mobile Bookmarks': 'MobileFolder' }
  const bookmarks = children.map(c => ({
    title: folderMap[c.title] || c.title || 'UnfiledFolder',
    children: (c.children || []).map(simplifyNode),
  }))
  return {
    browser: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    version: '1.0.0',
    createDate: Date.now(),
    bookmarks,
  }
}

function simplifyNode(node) {
  if (node.url) return { title: node.title || '', url: node.url }
  return { title: node.title || '', children: (node.children || []).map(simplifyNode) }
}

async function performBackup() {
  const { token, gistId, autoBackup } = await chrome.storage.sync.get(['token', 'gistId', 'autoBackup'])
  if (!token || autoBackup === false) return

  const tree = await chrome.bookmarks.getTree()
  const data = compactBookmarks(tree)
  const body = JSON.stringify(data)
  try { JSON.parse(body) } catch (e) { console.error('GistMark: JSON serialization failed'); return }
  const files = { 'GistMark-bookmarks.json': { content: body } }

  if (gistId) {
    const res = await fetch(`https://api.github.com/gists/${gistId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' },
      body: JSON.stringify({ files }),
    })
    if (!res.ok) {
      if (res.status === 404) {
        await chrome.storage.sync.remove('gistId')
        return performBackup()
      }
      return
    }
    await chrome.storage.local.set({ lastBackupAt: Date.now() })
    return
  }

  const res = await fetch('https://api.github.com/gists', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' },
    body: JSON.stringify({
      description: 'GistMark bookmarks',
      public: false,
      files,
    }),
  })
  if (!res.ok) return

  const gist = await res.json()
  await chrome.storage.sync.set({ gistId: gist.id })
  await chrome.storage.local.set({ lastBackupAt: Date.now() })
}

async function performRestore(token, gistId, onProgress) {
  const res = await fetch(`https://api.github.com/gists/${gistId}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' },
  })
  if (!res.ok) throw new Error(`Failed to fetch Gist: ${res.status}`)

  const gist = await res.json()
  const file = gist.files['GistMark-bookmarks.json']
  if (!file) throw new Error('GistMark-bookmarks.json not found in Gist')

  let raw
  if (file.raw_url) {
    const rawRes = await fetch(file.raw_url, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (rawRes.ok) raw = await rawRes.text()
  }
  if (!raw) raw = file.content
  const data = JSON.parse(raw)
  const rootFolders = Array.isArray(data.bookmarks) ? data.bookmarks : []
  if (!rootFolders.length) throw new Error('No bookmarks found in Gist')

  const roots = await chrome.bookmarks.getTree()
  const rootNode = roots[0]

  const nameMap = { 'ToolbarFolder': 'Bookmarks Bar', 'MenuFolder': 'Other Bookmarks', 'MobileFolder': 'Mobile Bookmarks' }
  const total = rootFolders.reduce((s, f) => s + countLeaves(f), 0)
  let restored = 0
  const report = () => {
    if (restored % 100 === 0 || restored === total) onProgress(restored, total)
  }

  const results = await Promise.all(rootFolders.map(node =>
    createCompactNode(node, rootNode.id, () => { restored++; report() }, nameMap)
  ))

  restored = results.reduce((a, b) => a + b, 0)
  onProgress(restored, total)
  return restored
}

function countLeaves(node) {
  if (node.url) return 1
  if (!node.children) return 0
  return node.children.reduce((s, c) => s + countLeaves(c), 0)
}

async function createCompactNode(node, parentId, onCreated, nameMap = {}) {
  if (node.url) {
    try {
      await chrome.bookmarks.create({ parentId, title: node.title || '', url: node.url })
      onCreated()
      return 1
    } catch (e) {
      if (e.message.includes('URL_INVALID')) {
        await chrome.bookmarks.create({ parentId, title: node.title || '', url: 'https://example.com' })
        onCreated()
        return 1
      }
      return 0
    }
  }
  if (!node.children || !node.children.length) return 0
  const title = nameMap[node.title] || node.title || ''
  const f = await chrome.bookmarks.create({ parentId, title })
  let count = 0
  for (let i = 0; i < node.children.length; i += 20) {
    const batch = node.children.slice(i, i + 20)
    const results = await Promise.all(batch.map(c => createCompactNode(c, f.id, onCreated)))
    count += results.reduce((a, b) => a + b, 0)
  }
  return count
}

async function recoverPendingBackup() {
  const { pendingBackupAt } = await chrome.storage.local.get('pendingBackupAt')
  if (pendingBackupAt && pendingBackupAt > Date.now()) {
    scheduleBackup(pendingBackupAt - Date.now())
  }
}

recoverPendingBackup()

chrome.runtime.onStartup.addListener(recoverPendingBackup)
