#!/bin/bash
# Copies dist/ into HA's www/glass-cards. Backs up the previous deploy to ScriptsHA first.
set -euo pipefail
# Where to: GLASS_DEST (HA's config/www/glass-cards) and GLASS_BACKUPS, from the environment
# or from scripts/.deploy.env (kept out of git).
cd "$(dirname "$0")/.."
[ -f scripts/.deploy.env ] && . scripts/.deploy.env
DEST="${GLASS_DEST:?set GLASS_DEST to HA's config/www/glass-cards (or put it in scripts/.deploy.env)}"
BACKUPS="${GLASS_BACKUPS:-}"
if [ -n "$BACKUPS" ] && [ -d "$DEST" ]; then
  stamp=$(date +%Y%m%d-%H%M%S)
  mkdir -p "$BACKUPS/glass-cards-$stamp"
  cp -R "$DEST/." "$BACKUPS/glass-cards-$stamp/"
  echo "backup: $BACKUPS/glass-cards-$stamp"
fi
mkdir -p "$DEST"
cp dist/glass-cards.js dist/glass-cards-loader.js dist/version.json "$DEST/"
mkdir -p "$DEST/wallpapers"
cp dist/wallpapers/*.jpg "$DEST/wallpapers/"
echo "deployed to $DEST: $(cat dist/version.json)"
