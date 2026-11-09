#!/bin/sh
# Install the git-panel mod for the Herdr desktop app.
#
#   curl -fsSL https://raw.githubusercontent.com/dhoaibao/herdr-mods/main/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/dhoaibao/herdr-mods/main/install.sh | sh -s -- --force
#
# Options:
#   --force      replace an existing git-panel mod (the old one is moved to <home>/backups/)
#   --no-keys    do not touch keys.json
#   -h, --help   show this help
#
# Environment (put it on the sh side of the pipe: `curl ... | HERDR_MODS_REF=<sha> sh`):
#   HERDR_APP_HOME    Herdr config home (default: ~/.config/herdr-app)
#   HERDR_MODS_REF    branch, tag or commit to install (default: main)
#   HERDR_MODS_SRC    path to a local checkout of this repo; skips the download
#
# Apart from a temporary directory, the script only writes inside the Herdr config home. It
# never overwrites an existing mod without --force, never creates keys.json (a file with one
# key would replace Herdr's default shortcuts), and never replaces a key binding you have.
#
# Everything runs inside main(), called on the last line, so a truncated download runs nothing.

REPO="dhoaibao/herdr-mods"
MOD="git-panel"

usage() {
  cat <<'EOF'
Usage: install.sh [--force] [--no-keys]

  --force      replace an existing git-panel mod (the old one is moved to <home>/backups/)
  --no-keys    do not touch keys.json

Environment: HERDR_APP_HOME (config home), HERDR_MODS_REF (branch, tag or commit),
HERDR_MODS_SRC (local checkout, skips the download).
EOF
}

say() { printf '%s\n' "$*"; }
die() { printf 'install.sh: %s\n' "$*" >&2; exit 1; }

cleanup() {
  rm -rf "$TMP"
  if [ -n "${STAGE:-}" ]; then rm -rf "$STAGE"; fi
  if [ -n "${KEYS_NEW:-}" ]; then rm -f "$KEYS_NEW"; fi
}

main() {
  set -eu
  REF="${HERDR_MODS_REF:-main}"
  HOME_DIR="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
  FORCE=0
  KEYS=1
  STAGE=""
  KEYS_NEW=""
  OLD=""
  ADDED=0

  for arg in "$@"; do
    case "$arg" in
      --force) FORCE=1 ;;
      --no-keys) KEYS=0 ;;
      -h|--help) usage; return 0 ;;
      *) echo "install.sh: unknown option: $arg" >&2; usage >&2; return 2 ;;
    esac
  done

  TMP=$(mktemp -d)
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  # 1. Find the mod sources: a local checkout, or the GitHub tarball for REF.
  if [ -n "${HERDR_MODS_SRC:-}" ]; then
    SRC="$HERDR_MODS_SRC/$MOD/mods/$MOD"
    KEYS_SRC="$HERDR_MODS_SRC/$MOD/keys.json"
  else
    command -v curl >/dev/null 2>&1 || die "curl is required"
    command -v tar >/dev/null 2>&1 || die "tar is required"
    say "Downloading $REPO@$REF ..."
    curl -fsSL "https://github.com/$REPO/archive/$REF.tar.gz" | tar -xz -C "$TMP" || die "download failed for ref '$REF'"
    ROOT=$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -n 1)
    [ -n "$ROOT" ] || die "empty archive"
    SRC="$ROOT/$MOD/mods/$MOD"
    KEYS_SRC="$ROOT/$MOD/keys.json"
  fi
  [ -f "$SRC/mod.json" ] || die "mod sources not found at $SRC"

  # 2. Install the mod folder: copy to a staging folder beside mods/ first, so a failed or
  #    interrupted copy never leaves a half-installed mod for Herdr to load.
  [ -d "$HOME_DIR" ] || die "Herdr config home not found: $HOME_DIR (run Herdr once, or set HERDR_APP_HOME)"
  DEST="$HOME_DIR/mods/$MOD"
  if [ -e "$DEST" ] || [ -L "$DEST" ]; then
    [ "$FORCE" -eq 1 ] || die "$DEST already exists; re-run with --force to replace it (the old copy is kept)"
  fi
  mkdir -p "$HOME_DIR/mods"
  STAGE="$HOME_DIR/.install-$MOD.$$"
  cp -R "$SRC" "$STAGE"
  if [ -e "$DEST" ] || [ -L "$DEST" ]; then
    # Kept outside mods/ so Herdr does not load the old copy as a second mod.
    mkdir -p "$HOME_DIR/backups"
    OLD="$HOME_DIR/backups/$MOD-$(date +%Y%m%d%H%M%S)"
    mv "$DEST" "$OLD"
    say "Moved the existing mod to $OLD"
  fi
  if ! mv "$STAGE" "$DEST"; then
    # Put the previous install back so the user is not left without the mod.
    if [ -n "$OLD" ] && [ -e "$OLD" ] && [ ! -e "$DEST" ] && [ ! -L "$DEST" ]; then mv "$OLD" "$DEST" && say "Restored the previous install from $OLD"; fi
    die "could not move the new copy into $DEST"
  fi
  say "Installed $MOD to $DEST"

  # 3. Add the key binding if it is free; never replace one that is in use. keys.json holds the
  #    whole keymap, so a missing file is not created (it would replace Herdr's defaults).
  if [ "$KEYS" -eq 1 ] && [ -f "$KEYS_SRC" ]; then
    KEYS_DST="$HOME_DIR/keys.json"
    MANUAL="to bind it, add this under \"global\" in $KEYS_DST yourself: $(tr -d '\n' < "$KEYS_SRC")"
    if [ ! -e "$KEYS_DST" ] && [ ! -L "$KEYS_DST" ]; then
      say "No keys.json in $HOME_DIR, so Herdr uses its built-in shortcuts; none was created (a file with one key would replace them). Once you have a keys.json, $MANUAL"
    elif [ -L "$KEYS_DST" ] || [ ! -f "$KEYS_DST" ]; then
      # A symlink (dotfiles managers) would be replaced by a plain file when the merge is moved in.
      say "$KEYS_DST is a symlink or not a regular file; left it alone; $MANUAL"
    elif grep -q 'ctrl-shift-g' "$KEYS_DST"; then
      say "ctrl-shift-g is already bound in $KEYS_DST; left it alone. If that is not git-panel, bind another key: add \"mod.open:git-panel\" under \"global\" in $KEYS_DST yourself."
    elif command -v jq >/dev/null 2>&1 \
      && [ "$(jq -s 'length' "$KEYS_DST" 2>/dev/null)" = "1" ] \
      && KEYS_NEW="$HOME_DIR/.keys.json.$$" \
      && cp "$KEYS_DST" "$KEYS_NEW" \
      && jq -s '.[0] * .[1]' "$KEYS_DST" "$KEYS_SRC" > "$KEYS_NEW" 2>/dev/null; then
      BAK="$KEYS_DST.bak-$(date +%Y%m%d%H%M%S)"
      cp "$KEYS_DST" "$BAK"
      mv "$KEYS_NEW" "$KEYS_DST"
      ADDED=1
      say "Added ctrl-shift-g to $KEYS_DST (backup: $BAK; Herdr no longer auto-updates a keys file you have edited)"
    else
      say "Could not merge keys automatically (jq missing, or keys.json is not a single plain JSON object); $MANUAL"
    fi
  fi

  say ""
  say "Done. Herdr hot-reloads mods."
  if [ "$ADDED" -eq 1 ]; then say "Press ctrl-shift-g to open git-panel."; fi
  say "The Pull requests tab needs the GitHub CLI: https://cli.github.com (gh auth login)."
}

main "$@"
