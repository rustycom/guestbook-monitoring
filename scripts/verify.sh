#!/usr/bin/env bash
# Acceptance test for the deployed stack. Prints a PASS/FAIL table; exits non-zero on any FAIL.
# Needs PULUMI_CONFIG_PASSPHRASE (for the Grafana password output) and the Pulumi backend that
# `make up` used (the Makefile exports PULUMI_BACKEND_URL).
set -euo pipefail
cd "$(dirname "$0")/.."

CTX=kind-guestbook-monitoring
K="kubectl --context=$CTX"
PROM_PORT=${PROM_PORT:-19090}
PROM="http://localhost:$PROM_PORT"
DASHBOARD=dashboards/guestbook-overview.json

$K -n monitoring port-forward svc/kps-prometheus "$PROM_PORT:9090" >/dev/null 2>&1 &
PF=$!
trap 'kill $PF 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do curl -sf "$PROM/-/ready" >/dev/null && break; sleep 1; done

RESULTS=()
FAILED=0
record() { # record <PASS|FAIL> <check> <detail>
  RESULTS+=("$(printf '%-4s  %-46s %s' "$1" "$2" "$3")")
  [ "$1" = PASS ] || FAILED=1
}
check() { # check <name> <detail-on-fail> <command...>
  local name=$1 detail=$2; shift 2
  if out=$("$@" 2>&1); then record PASS "$name" "$out"; else record FAIL "$name" "${out:-$detail}"; fi
}
# Instant query → number of series returned.
series() { curl -s --get "$PROM/api/v1/query" --data-urlencode "query=$1" | jq '.data.result | length'; }
# Instant query → sum of all returned values (0 if empty).
value() { curl -s --get "$PROM/api/v1/query" --data-urlencode "query=$1" | jq '[.data.result[].value[1] | tonumber] | add // 0'; }
gt() { awk -v a="$1" -v b="$2" 'BEGIN { exit !(a > b) }'; }

# 1. Pods Ready
pods_ready() {
  local bad
  bad=$($K -n "$1" get pods -o json | jq -r '.items[]
    | select(.status.phase != "Succeeded")
    | select([.status.conditions[]? | select(.type == "Ready" and .status == "True")] | length == 0)
    | .metadata.name')
  [ -z "$bad" ] || { echo "not ready: $bad"; return 1; }
  echo "$($K -n "$1" get pods --no-headers | wc -l | tr -d ' ') pods"
}
for ns in guestbook monitoring traefik; do check "pods Ready in $ns" "" pods_ready "$ns"; done

# 2. Scrape targets up
targets_up() { # targets_up <namespace> <job> <expected count or 0 for any>
  local t up total
  t=$(curl -s "$PROM/api/v1/targets?state=active")
  total=$(jq --arg ns "$1" --arg job "$2" '[.data.activeTargets[] | select(.labels.namespace == $ns and .labels.job == $job)] | length' <<<"$t")
  up=$(jq --arg ns "$1" --arg job "$2" '[.data.activeTargets[] | select(.labels.namespace == $ns and .labels.job == $job and .health == "up")] | length' <<<"$t")
  echo "$up/$total up"
  [ "$total" -gt 0 ] && [ "$up" -eq "$total" ] && { [ "$3" -eq 0 ] || [ "$total" -eq "$3" ]; }
}
FRONTEND_REPLICAS=$($K -n guestbook get deploy frontend -o jsonpath='{.spec.replicas}')
check "targets: frontend" "" targets_up guestbook frontend "$FRONTEND_REPLICAS"
check "targets: redis-leader" "" targets_up guestbook redis-leader 1
check "targets: redis-replica" "" targets_up guestbook redis-replica 1
check "targets: traefik" "" targets_up traefik traefik-metrics 0
no_down_targets() {
  local down
  down=$(curl -s "$PROM/api/v1/targets?state=active" | jq -r '.data.activeTargets[] | select(.health != "up") | "\(.labels.job)/\(.labels.instance)"')
  [ -z "$down" ] && echo "0 targets not up" || { echo "not up: $down"; return 1; }
}
check "targets: none down cluster-wide" "" no_down_targets

# 3. Exporter health
eq() { local v; v=$(value "$1"); echo "$v"; [ "$v" = "$2" ]; }
check "apache_up count == $FRONTEND_REPLICAS" "" eq 'count(apache_up{namespace="guestbook"} == 1)' "$FRONTEND_REPLICAS"
check "redis_up count == 2" "" eq 'count(redis_up{namespace="guestbook"} == 1)' 2
check "redis replica link up" "" eq 'redis_master_link_up{namespace="guestbook",service="redis-replica"}' 1
check "leader sees 1 replica" "" eq 'redis_connected_slaves{namespace="guestbook",service="redis-leader"}' 1

# 4. Edge traffic
edge_rate() { local v; v=$(value 'sum(rate(traefik_service_requests_total{service=~".*frontend.*"}[1m]))'); echo "$v req/s"; gt "$v" 0; }
check "edge request rate > 0" "" edge_rate

# 5. Every dashboard panel query returns data (queries read from the dashboard JSON itself)
while IFS=$'\t' read -r title expr; do
  q=${expr//\$__rate_interval/1m}
  q=${q//\$edge_service/.*frontend.*}
  n=$(series "$q")
  if [ "${n:-0}" -gt 0 ]; then record PASS "panel: $title" "$n series"; else record FAIL "panel: $title" "no data: $q"; fi
done < <(jq -r '.panels[] | select(.type != "row") | .title as $t | .targets[] | "\($t)\t\(.expr)"' "$DASHBOARD")

# 6. Grafana with the generated credentials
GRAFANA_URL=$(pulumi stack output grafanaUrl)
GRAFANA_USER=$(pulumi stack output grafanaAdminUser)
GRAFANA_PW=$(pulumi stack output grafanaAdminPassword --show-secrets)
grafana_health() { curl -s -u "$GRAFANA_USER:$GRAFANA_PW" "$GRAFANA_URL/api/health" | jq -e '.database == "ok"' >/dev/null && echo "database ok"; }
grafana_dashboard() {
  local c
  c=$(curl -s -o /dev/null -w '%{http_code}' -u "$GRAFANA_USER:$GRAFANA_PW" "$GRAFANA_URL/api/dashboards/uid/guestbook-overview")
  echo "HTTP $c"; [ "$c" = 200 ]
}
check "grafana /api/health" "" grafana_health
check "grafana dashboard guestbook-overview" "" grafana_dashboard

# 7. End-to-end write → replicate → read through the edge. Own key, so loadgen can't overwrite it.
GUESTBOOK_URL=$(pulumi stack output guestbookUrl)
e2e() {
  local v="verify-$(date +%s)" got
  curl -sf "$GUESTBOOK_URL/guestbook.php?cmd=set&key=verify&value=$v" >/dev/null
  for _ in $(seq 1 10); do
    got=$(curl -sf "$GUESTBOOK_URL/guestbook.php?cmd=get&key=verify" | jq -r .data)
    [ "$got" = "$v" ] && { echo "wrote+read $v via $GUESTBOOK_URL"; return 0; }
    sleep 1
  done
  echo "wrote $v, read back '$got'"; return 1
}
check "e2e write/read through guestbookUrl" "" e2e

printf '\n%-4s  %-46s %s\n' RES CHECK DETAIL
printf '%s\n' "${RESULTS[@]}"
if [ "$FAILED" -eq 0 ]; then echo; echo "ALL CHECKS PASSED"; else echo; echo "SOME CHECKS FAILED"; exit 1; fi
