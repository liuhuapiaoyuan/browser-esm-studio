#!/bin/sh
# Optional Authorization inject for /openai-proxy
# (reads VITE_AI_API_KEY, or AI_API_KEY as runtime alias).
set -eu

SNIPPET_DIR=/etc/nginx/snippets
SNIPPET="$SNIPPET_DIR/openai-auth.conf"
mkdir -p "$SNIPPET_DIR"

KEY="${VITE_AI_API_KEY:-${AI_API_KEY:-}}"

if [ -z "$KEY" ]; then
  cat >"$SNIPPET" <<'EOF'
# No VITE_AI_API_KEY / AI_API_KEY — client may send its own Authorization.
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
