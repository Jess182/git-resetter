# git-resetter

CLI tool to soft reset and restore commits. Compiled with [scriptc](https://github.com/vercel-labs/scriptc) to native standalone binaries without runtime dependencies.

## Installation

```console
curl -fsSL https://raw.githubusercontent.com/Jess182/git-resetter/main/install.sh | sh
```

The binary will be installed as `gitr` in `~/.local/bin/gitr`. Make sure `~/.local/bin` is in your `PATH`.

## Usage

```console
gitr reset <hash>
gitr restore <hash> [-s]
gitr dh <hash>
```

### Storage

Data is stored locally in `db.json`:
- **macOS:** `~/Library/Application Support/git-resetter/db.json`
- **Linux:** `$XDG_DATA_HOME/git-resetter/db.json` (default `~/.local/share/git-resetter/db.json`)

## Local Build

```console
scriptc build main.ts -o dist/gitr
```
