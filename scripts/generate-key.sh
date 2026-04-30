#!/usr/bin/env bash
#
# generate-key.sh
# Generates a 2048-bit RSA keypair, computes the stable Chrome extension ID,
# and prints the base64-encoded public key for pasting into manifest.json.
#
# Usage:
#   bash scripts/generate-key.sh
#
# After running:
#   1. Copy the printed "key": "..." line.
#   2. Paste it as the top-level "key" field in manifest.json (replace _NOTE_key).
#   3. Reload the extension. The extension ID will now be stable across reinstalls.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRIVATE_KEY_PATH="$REPO_ROOT/manifest-key-private.pem"
PUBLIC_KEY_DER="$REPO_ROOT/.manifest-key-public.der"

if [ -f "$PRIVATE_KEY_PATH" ]; then
  echo "Error: $PRIVATE_KEY_PATH already exists. Refusing to overwrite." >&2
  echo "If you really want to regenerate, delete it manually first." >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "Error: openssl is required but not found in PATH." >&2
  exit 1
fi

# 1. Generate 2048-bit RSA private key
openssl genrsa -out "$PRIVATE_KEY_PATH" 2048 2>/dev/null

# 2. Extract DER-encoded public key
openssl rsa -in "$PRIVATE_KEY_PATH" -pubout -outform DER -out "$PUBLIC_KEY_DER" 2>/dev/null

# 3. Base64-encode the DER public key (this is what goes in manifest.json "key")
PUB_B64=$(base64 < "$PUBLIC_KEY_DER" | tr -d '\n')

# 4. Compute the stable extension ID:
#    sha256 of DER public key, take first 32 hex chars, map 0-9a-f -> a-p
EXT_ID=$(openssl dgst -sha256 -binary "$PUBLIC_KEY_DER" | xxd -p -c 32 | cut -c1-32 | tr '0-9a-f' 'a-p')

# 5. Clean up the DER (private key stays — gitignored)
rm "$PUBLIC_KEY_DER"

echo ""
echo "──────────────────────────────────────────────────────────────"
echo "  Keypair generated"
echo "──────────────────────────────────────────────────────────────"
echo ""
echo "  Private key  : $PRIVATE_KEY_PATH"
echo "                 (gitignored — DO NOT commit, DO NOT lose)"
echo ""
echo "  Extension ID : $EXT_ID"
echo ""
echo "──────────────────────────────────────────────────────────────"
echo "  Paste this into manifest.json as the top-level \"key\" field"
echo "  (and remove the \"_NOTE_key\" placeholder):"
echo "──────────────────────────────────────────────────────────────"
echo ""
echo "  \"key\": \"$PUB_B64\","
echo ""
