#!/usr/bin/env bash
# Destroy the Pulumi stack (keeps the kind cluster). `make clean` deletes the cluster itself.
set -euo pipefail
cd "$(dirname "$0")/.."
pulumi stack select dev
pulumi destroy --yes --skip-preview
