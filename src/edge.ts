import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { Config } from "./config";

// Traefik in front of the frontend: mod_status has no HTTP status codes, so request/error rates
// by status come from the edge proxy's Prometheus metrics.
export function createEdge(args: {
    provider: k8s.Provider;
    config: Config;
    guestbookNamespace: pulumi.Input<string>;
    dependsOn: pulumi.Resource[]; // kps release: the chart's ServiceMonitor needs its CRD
}) {
    const { provider, config: cfg } = args;
    const opts = { provider };
    const nodePort = cfg.exposeAs === "NodePort";
    // Helm's own wait blocks on a LoadBalancer address, which kind never assigns.
    const skipWait = !nodePort && cfg.skipLbAwait;

    const ns = new k8s.core.v1.Namespace("traefik", { metadata: { name: "traefik" } }, opts);

    const release = new k8s.helm.v3.Release("traefik", {
        name: "traefik",
        chart: "traefik",
        version: cfg.charts.traefik.version,
        repositoryOpts: { repo: cfg.charts.traefik.repo },
        namespace: ns.metadata.name,
        timeout: 600,
        atomic: !skipWait, // atomic implies waiting
        skipAwait: skipWait,
        values: {
            service: { spec: { type: cfg.exposeAs } },
            ports: { web: { nodePort: nodePort ? cfg.nodePorts.guestbook : null } },
            // publishedService copies the Traefik Service address onto Ingress status (LoadBalancer).
            providers: { kubernetesIngress: { enabled: true, publishedService: { enabled: true } } },
            metrics: {
                prometheus: {
                    addServicesLabels: true,
                    addEntryPointsLabels: true,
                    // Dedicated metrics Service: the main Service doesn't expose the metrics port.
                    service: { enabled: true },
                    serviceMonitor: {
                        enabled: true,
                        additionalLabels: { release: "kps" },
                        // Keep Traefik's own `service` label (e.g. guestbook-frontend-80@kubernetes)
                        // instead of it being renamed exported_service by the scrape target's.
                        honorLabels: true,
                    },
                },
            },
        },
    }, { ...opts, dependsOn: args.dependsOn });

    new k8s.networking.v1.Ingress("guestbook", {
        metadata: {
            name: "guestbook",
            namespace: args.guestbookNamespace,
            // With NodePort there is no address to publish, so Pulumi would wait for one forever.
            annotations: nodePort || skipWait ? { "pulumi.com/skipAwait": "true" } : undefined,
        },
        spec: {
            ingressClassName: "traefik",
            rules: [{
                http: {
                    paths: [{
                        path: "/",
                        pathType: "Prefix",
                        backend: { service: { name: "frontend", port: { number: 80 } } },
                    }],
                },
            }],
        },
    }, { ...opts, dependsOn: [release] });

    const guestbookUrl = nodePort
        ? pulumi.output(`http://${cfg.nodeHost}:${cfg.nodePorts.guestbook}`)
        : k8s.core.v1.Service.get("traefik", pulumi.interpolate`${release.status.namespace}/${release.status.name}`, opts)
            .status.loadBalancer.ingress.apply(ing => {
                const addr = ing?.[0]?.ip ?? ing?.[0]?.hostname;
                return addr ? `http://${addr}` : "pending — run: pulumi refresh";
            });

    return { release, guestbookUrl };
}
