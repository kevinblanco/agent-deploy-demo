#!/usr/bin/env bash
# Contract checks for cart-pricing: the finance rules, as live HTTP calls.
#
# Owned by humans (see .github/CODEOWNERS). Coding agents may change the app
# and its unit tests, but not these checks. The pipeline's verify step runs
# the same checks against every deployment, and a failure rolls it back.
#
# Usage: contract/contract-check.sh http://localhost:8080
# Needs only bash and curl (or wget), so it runs on the Harness delegate.
set -uo pipefail

BASE_URL="${1:-${BASE_URL:-http://localhost:8080}}"
CART='{"items":[{"sku":"KB-01","unitPrice":1999,"qty":2},{"sku":"MS-02","unitPrice":4999,"qty":1}]'
failures=0

post() { # post <path> <json>  → prints body, then the HTTP status on the last line
  if command -v curl >/dev/null; then
    curl -s -w '\n%{http_code}' -H 'content-type: application/json' -d "$2" "$BASE_URL$1"
  else
    wget -q -S -O - --header='content-type: application/json' --post-data="$2" "$BASE_URL$1" 2>&1 \
      | awk '/^  HTTP/{code=$2} !/^  /{print} END{print code}'
  fi
}

check() { # check <name> <path> <json> <expected status> <expected body fragment>
  local out status body
  out="$(post "$2" "$3")"
  status="$(tail -n1 <<<"$out")"
  body="$(sed '$d' <<<"$out")"
  if [[ "$status" == "$4" && "$body" == *"$5"* ]]; then
    printf '  ✓ %s\n' "$1"
  else
    printf '  ✗ %s\n      expected %s %s\n      got      %s %s\n' "$1" "$4" "$5" "$status" "$body"
    failures=$((failures + 1))
  fi
}

echo "Contract checks against $BASE_URL"

check "subtotal = sum(price × qty)" /quote "$CART}" 200 '"total":8997'
check "SAVE10 takes 10% off, rounded half up" /quote "$CART,\"discountCode\":\"SAVE10\"}" 200 '"discount":900'
check "tax applies after the discount" /quote "$CART,\"discountCode\":\"SAVE10\",\"taxRate\":0.0825}" 200 '"total":8765'
check "unknown codes are rejected" /quote "$CART,\"discountCode\":\"FREE100\"}" 400 'unknown discount code'

if (( failures > 0 )); then
  echo "$failures contract check(s) failed: this version must not ship."
  exit 1
fi
echo "All contract checks passed."
