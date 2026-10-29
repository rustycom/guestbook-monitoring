#!/usr/bin/env bash
# Create the kind cluster (idempotent: reuses it if it already exists).
set -euo pipefail
cd "$(dirname "$0")/.."
NAME=guestbook-monitoring
if kind get clusters 2>/dev/null | grep -x "$NAME" >/dev/null; then  # no -q: avoids SIGPIPE under pipefail
  echo "kind cluster '$NAME' already exists, reusing it"
else
  kind create cluster --config cluster/kind-config.yaml --wait 120s
fi
kubectl --context "kind-$NAME" wait --for=condition=Ready node --all --timeout=120s
