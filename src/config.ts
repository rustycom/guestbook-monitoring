import * as pulumi from "@pulumi/pulumi";

const c = new pulumi.Config();

const exposeAs = c.get("exposeAs") ?? "NodePort";
if (exposeAs !== "NodePort" && exposeAs !== "LoadBalancer") {
    throw new Error(`exposeAs must be "NodePort" or "LoadBalancer", got "${exposeAs}"`);
}

export const config = {
    // Required, never defaulted in code: we must not fall back to the ambient kube context.
    kubeContext: c.require("kubeContext"),
    frontendServiceType: c.get("frontendServiceType") ?? "ClusterIP",
    // How Grafana (and later the Traefik edge) is exposed outside the cluster.
    exposeAs: exposeAs as "NodePort" | "LoadBalancer",
    // Host used to build URLs for NodePort exposure (kind maps NodePorts onto localhost).
    nodeHost: c.get("nodeHost") ?? "localhost",
    // Don't wait for a LoadBalancer address (kind never assigns one).
    skipLbAwait: c.getBoolean("skipLbAwait") ?? false,
    nodePorts: { grafana: 30300, guestbook: 30080 },
    images: {
        // Upstream only publishes `latest`; pinned by digest.
        frontend:
            "pulumi/guestbook-php-redis@sha256:f21cbff35c0bad29d0c480f741e19919fb135d7c7941b8b5fc7240503d0a1c4f",
        // Leader and replica share one pinned image (see README "Upstream issue found").
        redis: "redis:8.10.3",
        apacheExporter: "lusotycoon/apache-exporter:v1.1.1",
        redisExporter: "oliver006/redis_exporter:v1.96.0",
    },
    charts: {
        kubePrometheusStack: {
            repo: "https://prometheus-community.github.io/helm-charts",
            version: "92.14.1",
        },
        traefik: {
            repo: "https://traefik.github.io/charts",
            version: "42.1.3",
        },
    },
};

export type Config = typeof config;
