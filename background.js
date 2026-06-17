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

async function recoverPendingBackup() {
  const { pendingBackupAt } = await chrome.storage.local.get('pendingBackupAt')
  if (pendingBackupAt && pendingBackupAt > Date.now()) {
    scheduleBackup(pendingBackupAt - Date.now())
  }
}

recoverPendingBackup()

chrome.runtime.onStartup.addListener(recoverPendingBackup)
