#!/bin/sh
set -e

REPO="Jess182/git-resetter"
BINARY="gitr"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$ARCH" in
	x86_64|amd64) ARCH="x64" ;;
	arm64|aarch64) ARCH="arm64" ;;
	*) echo "Unsupported architecture: $ARCH" && exit 1 ;;
esac

case "$OS" in
	linux) ASSET="gitr-linux-$ARCH" ;;
	darwin) ASSET="gitr-darwin-$ARCH" ;;
	*) echo "Unsupported OS: $OS" && exit 1 ;;
esac

TAG="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')"
if [ -z "$TAG" ]; then
	echo "Failed to fetch latest release tag"
	exit 1
fi

URL="https://github.com/$REPO/releases/download/$TAG/$ASSET"

echo "Downloading $ASSET from $TAG..."
mkdir -p "$INSTALL_DIR"
curl -fsSL "$URL" -o "$INSTALL_DIR/$BINARY"
chmod +x "$INSTALL_DIR/$BINARY"

echo "Installed $BINARY to $INSTALL_DIR/$BINARY"

