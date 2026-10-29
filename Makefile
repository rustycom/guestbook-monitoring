# Usage: export PULUMI_CONFIG_PASSPHRASE=<anything>; make cluster up verify
SHELL := /bin/bash
export PULUMI_BACKEND_URL ?= file://$(CURDIR)/.pulumi-state
export PULUMI_SKIP_UPDATE_CHECK := true

.PHONY: cluster up verify down clean check-passphrase

cluster:
	./scripts/cluster-up.sh

up: check-passphrase
	npm ci --no-fund --no-audit
	mkdir -p .pulumi-state
	pulumi stack select --create dev
	pulumi up --yes --skip-preview --refresh

verify: check-passphrase
	./scripts/verify.sh

down: check-passphrase
	./scripts/down.sh

clean:
	kind delete cluster --name guestbook-monitoring

check-passphrase:
	@test -n "$$PULUMI_CONFIG_PASSPHRASE" || { echo "Set PULUMI_CONFIG_PASSPHRASE first (any value; it encrypts the local Pulumi state)."; exit 1; }
