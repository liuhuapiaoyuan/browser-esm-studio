#!/bin/sh
# Optional Authorization inject for /lite-image-proxy
# (mirrors Vite: inject only when LITE_IMAGE_API_KEY is set).
set -eu

SNIPPET_DIR=/etc/nginx/snippets
SNIPPET="$SNIPPET_DIR/lite-image-auth.conf"
mkdir -p "$SNIPPET_DIR"

KEY="${LITE_IMAGE_API_KEY:-}"

if [ -z "$KEY" ]; then
  cat >"$SNIPPET" <<'EOF'
# No LITE_IMAGE_API_KEY — client may send its own Authorization.
EOF
  exit 0
fi

case "$KEY" in
  [Bb]earer\ *) AUTH="$KEY" ;;
  *) AUTH="Bearer $KEY" ;;
esac

# Escape for nginx double-quoted string
ESCAPED=$(printf '%s' "$AUTH" | sed 's/\\/\\\\/g; s/"/\\"/g')

printf 'proxy_set_header Authorization "%s";\n' "$ESCAPED" >"$SNIPPET"
