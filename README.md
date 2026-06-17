# GistMark

**Backup and restore your Chrome/Firefox bookmarks to a private GitHub Gist.**

![GistMark popup](screenshot/GistMark.png)

## Features

- **Backup** — one-click upload of your entire bookmark tree (folders, sub-folders, all bookmarks) to a private GitHub Gist
- **Auto-backup** — automatically syncs to Gist 15 seconds after any bookmark change
- **Restore** — import bookmarks from your Gist into a dated folder under "Other Bookmarks" on a new browser
- **Compact JSON** — stores bookmarks in a minimal format (no Chrome internal IDs, just titles, URLs, and folder structure)
- **Dark theme** — easy-on-the-eyes popup UI
- **Cross-browser** — works on Chrome and Firefox 120+
- **No build tools** — pure vanilla JavaScript, HTML, and CSS

## Prerequisites

- A **GitHub account**
- A **classic GitHub personal access token** with **only `gist` scope** (no other permissions needed)

### How to create your token

1. Go to [GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)](https://github.com/settings/tokens)
2. Click **Generate new token (classic)**
3. Give it a name like `GistMark`
4. Under **Scopes**, check only **`gist`** (create gists)
5. Scroll down and click **Generate token**
6. **Copy the token** — you'll paste it into the extension popup (GitHub only shows it once)

> **Important:** Use a **classic** token, not a fine-grained token. Fine-grained tokens don't support the Gist API scope.

## Installation

### Download the extension

1. Go to the [GistMark GitHub repo](https://github.com/Yesmohsen/GistMark)
2. Click the green **Code** button → **Download ZIP**
3. Unzip the downloaded file to a folder on your computer

### Load in Chrome

1. Open `chrome://extensions` in your browser
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the unzipped `GistMark` folder
5. The GistMark icon will appear in your toolbar

### Load in Firefox

1. Open `about:debugging#/runtime/this-firefox` in your browser
2. Click **Load Temporary Add-on**
3. Select the `manifest.json` file inside the unzipped `GistMark` folder
4. The GistMark icon will appear in your toolbar

> **Note for Firefox:** The extension will only stay loaded until you close Firefox. For permanent installation, you'll need to [sign the extension on addons.mozilla.org](https://addons.mozilla.org/).

## How to use

### Backup your bookmarks

1. Click the GistMark icon in your toolbar to open the popup
2. Paste your GitHub token into the **Gist Token** field (use the eye icon to toggle visibility)
3. Click **Backup NOW**
4. Done — your bookmarks are now saved to a private Gist!

### Auto-backup

Toggle **Auto Backup** on and your bookmarks will automatically sync to your Gist 15 seconds after any bookmark change (add, delete, rename, or move).

### Restore on a new browser

1. Install GistMark on the new browser (follow the Installation steps above)
2. Paste your **same GitHub token** into the popup
3. Click **Restore from Gist**
4. Confirm — a folder named `GistMark Restore (MM-DD-YYYY)` will appear under **Other Bookmarks** with your full bookmark tree

## File structure

```
GistMark/
├── manifest.json          # Extension manifest (MV3)
├── background.js          # Service worker — auto-backup timer + Gist API
├── popup/
│   ├── popup.html         # Popup UI
│   ├── popup.js           # Popup logic
│   └── popup.css          # Dark theme styles
├── screenshot/
│   └── GistMark.png       # Popup screenshot
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Gist format

Your bookmarks are saved as a single `GistMark-bookmarks` file in a private Gist:

```json
{"browser":"Mozilla/5.0 ...","version":"1.0.0","createDate":...,"bookmarks":[{"title":"ToolbarFolder","children":[...]},{"title":"MenuFolder","children":[]},{"title":"MobileFolder","children":[]}]}
```

## Tech stack

- **Manifest V3** — latest extension API
- **Chrome Bookmarks API** — reads/writes the native bookmark tree
- **GitHub REST API** — creates and updates the Gist
- **Zero build** — no npm, no bundlers, straight JavaScript
