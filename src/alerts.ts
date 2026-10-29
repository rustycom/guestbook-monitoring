import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

const runbook = (anchor: string) => `README.md#${anchor}`;
const edge = `service=~".*frontend.*"`;

// Small, high-signal rule set for the guestbook. Runbooks live in the README.
export function createAlerts(args: {
    provider: k8s.Provider;
    namespace: pulumi.Input<string>;
    dependsOn: pulumi.Resource[];
}) {
    return new k8s.apiextensions.CustomResource("guestbook-alerts", {
        apiVersion: "monitoring.coreos.com/v1",
        kind: "PrometheusRule",
        metadata: { name: "guestbook", namespace: args.namespace, labels: { release: "kps" } },
        spec: {
            groups: [{
                name: "guestbook",
                rules: [
                    {
                        // absent(): a Deployment scaled to zero has no target at all, so `up == 0`
                        // alone would stay silent through a total outage.
                        alert: "GuestbookScrapeTargetDown",
                        expr: `up{namespace="guestbook"} == 0
  or absent(up{namespace="guestbook",job="frontend"})
  or absent(up{namespace="guestbook",job="redis-leader"})
  or absent(up{namespace="guestbook",job="redis-replica"})`,
                        for: "2m",
                        labels: { severity: "warning" },
                        annotations: {
                            summary: "Guestbook scrape target {{ $labels.job }} is down or missing",
                            description: "For 2 minutes Prometheus has either failed to scrape {{ $labels.job }} ({{ $labels.pod }}) or found no target for it at all; the exporter or the whole workload is unhealthy.",
                            runbook: runbook("guestbookscrapetargetdown"),
                        },
                    },
                    {
                        alert: "GuestbookHigh5xxRatio",
                        expr: `(sum(rate(traefik_service_requests_total{${edge},code=~"5.."}[5m])) or vector(0))
  / sum(rate(traefik_service_requests_total{${edge}}[5m])) > 0.05`,
                        for: "5m",
                        labels: { severity: "critical" },
                        annotations: {
                            summary: "Guestbook is answering more than 5% of requests with 5xx",
                            description: "5xx ratio at the Traefik edge is {{ $value | humanizePercentage }} over the last 5 minutes.",
                            runbook: runbook("guestbookhigh5xxratio"),
                        },
                    },
                    {
                        alert: "GuestbookRedisDown",
                        expr: `redis_up{namespace="guestbook"} == 0`,
                        for: "1m",
                        labels: { severity: "critical" },
                        annotations: {
                            summary: "Redis {{ $labels.service }} is down",
                            description: "redis_exporter in {{ $labels.pod }} cannot reach its Redis; guestbook reads or writes fail.",
                            runbook: runbook("guestbookredisdown"),
                        },
                    },
                    {
                        // Leader-side check too: if the replica pod is gone, its own exporter (and so
                        // redis_master_link_up) disappears, but the leader still sees 0 replicas.
                        alert: "GuestbookRedisReplicationBroken",
                        expr: `redis_connected_slaves{namespace="guestbook",service="redis-leader"} < 1
  or redis_master_link_up{namespace="guestbook",service="redis-replica"} == 0`,
                        for: "2m",
                        labels: { severity: "warning" },
                        annotations: {
                            summary: "Redis replication between leader and replica is broken",
                            description: "The replica is not connected to the leader; guestbook reads (served by the replica) are stale or failing.",
                            runbook: runbook("guestbookredisreplicationbroken"),
                        },
                    },
                ],
            }],
        },
    }, { provider: args.provider, dependsOn: args.dependsOn });
}
