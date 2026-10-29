import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

// One ServiceMonitor per guestbook Service, scraping the exporter sidecars' `metrics` port.
// Job name defaults to the Service name: frontend, redis-leader, redis-replica.
export function createServiceMonitors(args: {
    provider: k8s.Provider;
    namespace: pulumi.Input<string>;
    dependsOn: pulumi.Resource[];
}) {
    const targets = [
        { name: "frontend", tier: "frontend" },
        { name: "redis-leader", tier: "backend" },
        { name: "redis-replica", tier: "backend" },
    ];
    return targets.map(t => new k8s.apiextensions.CustomResource(`guestbook-${t.name}`, {
        apiVersion: "monitoring.coreos.com/v1",
        kind: "ServiceMonitor",
        metadata: {
            name: `guestbook-${t.name}`,
            namespace: args.namespace,
            labels: { release: "kps" }, // also matched by the chart's default selector
        },
        spec: {
            selector: { matchLabels: { app: t.name } },
            endpoints: [{
                port: "metrics",
                path: "/metrics",
                interval: "15s",
                relabelings: [
                    { action: "replace", sourceLabels: ["__meta_kubernetes_pod_label_app"], targetLabel: "app" },
                    { action: "replace", targetLabel: "tier", replacement: t.tier },
                ],
            }],
        },
    }, { provider: args.provider, dependsOn: args.dependsOn }));
}
