const state = {
  token: '',
  autoBackup: false,
  gistId: null,
  lastBackupAt: null,
  backupInProgress: false,
  bookmarkCount: 0,
  folderCount: 0,
  treeHTML: '',
}

const $ = id => document.getElementById(id)

document.addEventListener('DOMContentLoaded', async () => {
  await loadState()
  await loadBookmarks()
  render()
  bindEvents()
})

async function loadState() {
  const sync = await chrome.storage.sync.get(['token', 'autoBackup', 'gistId'])
  const local = await chrome.storage.local.get('lastBackupAt')
  Object.assign(state, sync, local)
}

async function loadBookmarks() {
  const tree = await chrome.bookmarks.getTree()
  const stats = countBookmarks(tree)
  state.bookmarkCount = stats.bookmarks
  state.folderCount = stats.folders
  state.treeHTML = renderTree(tree)
}

function countBookmarks(nodes) {
  let bookmarks = 0
  let folders = 0
  for (const n of nodes) {
    if (n.url) bookmarks++
    else folders++
    if (n.children) {
      const c = countBookmarks(n.children)
      bookmarks += c.bookmarks
      folders += c.folders
    }
  }
  return { bookmarks, folders }
}

function renderTree(nodes, depth = 0) {
  let html = '<ul>'
  for (const n of nodes) {
    const indent = n.url ? '' : ' class="folder"'
    html += `<li${indent}>`
    if (n.url) {
      html += `<a href="${esc(n.url)}" target="_blank">${esc(n.title || n.url)}</a>`
    } else {
      html += `<strong>${esc(n.title || '(root)')}</strong>`
      if (n.children) html += renderTree(n.children, depth + 1)
    }
    html += '</li>'
  }
  html += '</ul>'
  return html
}

function esc(s) {
  const d = document.createElement('div')
  d.textContent = s
  return d.innerHTML
}

function render() {
  $('token').value = state.token || ''
  $('autoBackup').checked = state.autoBackup ?? true
  $('backupNow').disabled = !state.token
  $('restoreBtn').disabled = !state.token || !state.gistId

  $('totalBookmarks').textContent = state.bookmarkCount
  $('totalFolders').textContent = state.folderCount
  $('lastBackup').textContent = state.lastBackupAt
    ? new Date(state.lastBackupAt).toLocaleString()
    : 'Never'
  $('bookmarkTree').innerHTML = state.treeHTML
}

function bindEvents() {
  $('token').addEventListener('input', saveToken)
  $('toggleToken').addEventListener('click', toggleTokenVisibility)
  $('autoBackup').addEventListener('change', saveAutoBackup)
  $('backupNow').addEventListener('click', backupNow)
  $('restoreBtn').addEventListener('click', restoreFromGist)

  chrome.bookmarks.onCreated.addListener(onBookmarkChange)
  chrome.bookmarks.onRemoved.addListener(onBookmarkChange)
  chrome.bookmarks.onChanged.addListener(onBookmarkChange)
  chrome.bookmarks.onMoved.addListener(onBookmarkChange)
}

let changeTimer
function onBookmarkChange() {
  loadBookmarks().then(() => {
    $('totalBookmarks').textContent = state.bookmarkCount
    $('totalFolders').textContent = state.folderCount
    $('bookmarkTree').innerHTML = state.treeHTML
  })
  clearTimeout(changeTimer)
  changeTimer = setTimeout(() => scheduleBackup(), 2000)
}

async function saveToken() {
  state.token = $('token').value.trim()
  await chrome.storage.sync.set({ token: state.token })
  $('backupNow').disabled = !state.token
  $('restoreBtn').disabled = !state.token || !state.gistId
}

function toggleTokenVisibility() {
  const input = $('token')
  input.type = input.type === 'password' ? 'text' : 'password'
}

async function saveAutoBackup() {
  state.autoBackup = $('autoBackup').checked
  await chrome.storage.sync.set({ autoBackup: state.autoBackup })
}

function scheduleBackup() {
  if (!state.autoBackup || !state.token) return
  chrome.runtime.sendMessage({ type: 'SCHEDULE_BACKUP', delayMs: 15000 })
}

async function backupNow() {
  if (state.backupInProgress) return
  state.backupInProgress = true
  $('backupNow').disabled = true
  $('backupNow').textContent = 'Backing up...'
  $('lastBackup').textContent = 'Backing up...'

  try {
    const result = await doBackup()
    state.lastBackupAt = Date.now()
    await chrome.storage.local.set({ lastBackupAt: state.lastBackupAt })
    $('lastBackup').textContent = new Date(state.lastBackupAt).toLocaleString()
    showStatus('Backup complete!', 'success')
  } catch (err) {
    showStatus(`Backup failed: ${err.message}`, 'error')
  } finally {
    state.backupInProgress = false
    $('backupNow').disabled = !state.token
    $('restoreBtn').disabled = !state.token || !state.gistId
    $('backupNow').textContent = 'Backup NOW'
  }
}

async function doBackup() {
  const { token, gistId } = await chrome.storage.sync.get(['token', 'gistId'])

  const tree = await chrome.bookmarks.getTree()
  const data = compactBookmarks(tree)
  const body = JSON.stringify(data)

  // Validate JSON is well-formed before sending
  try { JSON.parse(body) } catch (e) { throw new Error('Failed to serialize bookmarks') }

  const files = { 'GistMark-bookmarks.json': { content: body } }

  if (gistId) {
    const res = await fetch(`https://api.github.com/gists/${gistId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' },
      body: JSON.stringify({ files }),
    })
    if (res.status === 404) {
      await chrome.storage.sync.remove('gistId')
      state.gistId = null
      return doBackup()
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.message || `HTTP ${res.status}`)
    }

    // Non-fatal verification: check the gist was stored correctly
    try {
      const check = await fetch(`https://api.github.com/gists/${gistId}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' },
      })
      if (check.ok) {
        const gist = await check.json()
        const saved = gist.files['GistMark-bookmarks.json']
        if (saved && saved.raw_url) {
          const rawRes = await fetch(saved.raw_url, {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (rawRes.ok) JSON.parse(await rawRes.text())
        }
      }
    } catch (e) {
      console.warn('GistMark: backup verification failed', e)
    }

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
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `HTTP ${res.status}`)
  }

  const gist = await res.json()

    // Verify backup via raw_url (non-fatal — just warn on failure)
  const gistContent = gist.files['GistMark-bookmarks.json']
  if (gistContent && gistContent.raw_url) {
    try {
      const rawRes = await fetch(gistContent.raw_url, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (rawRes.ok) {
        const rawText = await rawRes.text()
        JSON.parse(rawText)
      }
    } catch (e) {
      console.warn('GistMark: backup verification failed', e)
    }
  }

  state.gistId = gist.id
  await chrome.storage.sync.set({ gistId: gist.id })
  return gist
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
    browser: navigator.userAgent,
    version: '1.0.0',
    createDate: Date.now(),
    bookmarks,
  }
}

function simplifyNode(node) {
  if (node.url) return { title: node.title || '', url: node.url }
  return { title: node.title || '', children: (node.children || []).map(simplifyNode) }
}

async function restoreFromGist() {
  if (!confirm('This will restore bookmarks from your Gist into a new folder under Other Bookmarks. Continue?')) return

  $('restoreBtn').disabled = true
  $('restoreBtn').textContent = 'Restoring...'

  try {
    const { token, gistId } = await chrome.storage.sync.get(['token', 'gistId'])
    const res = await fetch(`https://api.github.com/gists/${gistId}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' },
    })
    if (!res.ok) throw new Error(`Failed to fetch Gist: ${res.status}`)

    const gist = await res.json()
    const file = gist.files['GistMark-bookmarks.json']
    if (!file) throw new Error('GistMark-bookmarks.json not found in Gist')

    // Always prefer raw_url — GitHub API truncates content for large files
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
    const otherBookmarks = roots[0].children.find(c => c.title === 'Other Bookmarks')
    if (!otherBookmarks) throw new Error('Could not find Other Bookmarks folder')

    const date = new Date().toLocaleDateString().replace(/\//g, '-')
    const folder = await chrome.bookmarks.create({
      parentId: otherBookmarks.id,
      title: `GistMark Restore (${date})`,
    })

    let restored = 0
    for (const node of rootFolders) {
      restored += await createCompact(node, folder.id)
    }

    showStatus(`Restored ${restored} bookmarks into "${folder.title}"`, 'success')
  } catch (err) {
    const hint = err.message.includes('JSON') ? ' The backup file in your Gist is corrupted. Do a fresh Backup NOW first, then try Restore again.' : ''
    showStatus(`Restore failed: ${err.message}${hint}`, 'error')
  } finally {
    $('restoreBtn').disabled = !state.token || !state.gistId
    $('restoreBtn').textContent = 'Restore from Gist'
  }
}

async function createCompact(node, parentId) {
  let count = 0
  if (node.url) {
    try {
      await chrome.bookmarks.create({ parentId, title: node.title || '', url: node.url })
      count++
    } catch (e) {
      if (e.message.includes('URL_INVALID')) {
        await chrome.bookmarks.create({ parentId, title: node.title || '', url: 'https://example.com' })
        count++
      }
    }
  } else if (node.children) {
    const f = await chrome.bookmarks.create({ parentId, title: node.title || '' })
    for (const child of node.children) {
      count += await createCompact(child, f.id)
    }
  }
  return count
}

function showStatus(msg, type = 'info') {
  const el = $('status')
  el.textContent = msg
  el.className = `show ${type}`
  clearTimeout(el._hide)
  el._hide = setTimeout(() => { el.className = '' }, 4000)
}
