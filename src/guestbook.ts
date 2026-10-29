// Copyright 2016-2025, Pulumi Corporation.  All rights reserved.
// Adapted from pulumi/examples kubernetes-ts-guestbook/simple (see NOTICE).

import * as k8s from "@pulumi/kubernetes";
import { Config } from "./config";

export function createGuestbook(args: { provider: k8s.Provider; config: Config }) {
    const { provider, config: cfg } = args;
    const opts = { provider };

    // Sidecar exporters: tiny footprint, readiness gated on the exporter answering /metrics.
    const exporterResources = { requests: { cpu: "10m", memory: "16Mi" }, limits: { cpu: "50m", memory: "64Mi" } };
    const metricsProbe = (port: number) => ({ httpGet: { path: "/metrics", port } });
    const redisExporter = {
        name: "redis-exporter",
        image: cfg.images.redisExporter,
        env: [{ name: "REDIS_ADDR", value: "redis://localhost:6379" }],
        ports: [{ name: "metrics", containerPort: 9121 }],
        resources: exporterResources,
        readinessProbe: metricsProbe(9121),
    };

    const ns = new k8s.core.v1.Namespace("guestbook", { metadata: { name: "guestbook" } }, opts);
    const namespace = ns.metadata.name;

    //
    // REDIS LEADER.
    //

    const redisLeaderLabels = { app: "redis-leader" };
    const redisLeaderDeployment = new k8s.apps.v1.Deployment("redis-leader", {
        metadata: { name: "redis-leader", namespace },
        spec: {
            selector: { matchLabels: redisLeaderLabels },
            template: {
                metadata: { labels: redisLeaderLabels },
                spec: {
                    containers: [
                        {
                            name: "redis-leader",
                            image: cfg.images.redis,
                            resources: { requests: { cpu: "100m", memory: "100Mi" } },
                            ports: [{ containerPort: 6379 }],
                        },
                        redisExporter,
                    ],
                },
            },
        },
    }, opts);
    const redisLeaderService = new k8s.core.v1.Service("redis-leader", {
        metadata: {
            name: "redis-leader",
            namespace,
            labels: redisLeaderLabels,
        },
        spec: {
            ports: [
                { name: "redis", port: 6379, targetPort: 6379 },
                { name: "metrics", port: 9121, targetPort: "metrics" },
            ],
            selector: redisLeaderLabels,
        },
    }, opts);

    //
    // REDIS REPLICA.
    //

    // Upstream's pulumi/guestbook-redis-replica image is Redis 6.0.5 and cannot load the RDB
    // (format v15) streamed by a current Redis leader, so replication never comes up and every
    // guestbook read returns empty. Use the same pinned official image as the leader instead.
    const redisReplicaLabels = { app: "redis-replica" };
    const redisReplicaDeployment = new k8s.apps.v1.Deployment("redis-replica", {
        metadata: { name: "redis-replica", namespace },
        spec: {
            selector: { matchLabels: redisReplicaLabels },
            template: {
                metadata: { labels: redisReplicaLabels },
                spec: {
                    containers: [
                        {
                            name: "replica",
                            image: cfg.images.redis,
                            args: ["--replicaof", "redis-leader", "6379"],
                            resources: { requests: { cpu: "100m", memory: "100Mi" } },
                            ports: [{ containerPort: 6379 }],
                        },
                        redisExporter,
                    ],
                },
            },
        },
    }, opts);
    const redisReplicaService = new k8s.core.v1.Service("redis-replica", {
        metadata: {
            name: "redis-replica",
            namespace,
            labels: redisReplicaLabels,
        },
        spec: {
            ports: [
                { name: "redis", port: 6379, targetPort: 6379 },
                { name: "metrics", port: 9121, targetPort: "metrics" },
            ],
            selector: redisReplicaLabels,
        },
    }, opts);

    //
    // FRONTEND
    //

    const frontendLabels = { app: "frontend" };
    const frontendDeployment = new k8s.apps.v1.Deployment("frontend", {
        metadata: { name: "frontend", namespace },
        spec: {
            selector: { matchLabels: frontendLabels },
            replicas: 3,
            template: {
                metadata: { labels: frontendLabels },
                spec: {
                    containers: [
                        {
                            name: "frontend",
                            image: cfg.images.frontend,
                            resources: { requests: { cpu: "100m", memory: "100Mi" } },
                            // If your cluster config does not include a dns service, then to instead access an environment
                            // variable to find the master service's host, change `value: "dns"` to read `value: "env"`.
                            env: [{ name: "GET_HOSTS_FROM", value: "dns" /* value: "env"*/ }],
                            ports: [{ containerPort: 80 }],
                        },
                        {
                            // Reads mod_status, which the image already enables with `Require local`;
                            // as a sidecar it reaches it over localhost, so the page stays private.
                            name: "apache-exporter",
                            image: cfg.images.apacheExporter,
                            args: ["--scrape_uri=http://localhost/server-status?auto"],
                            ports: [{ name: "metrics", containerPort: 9117 }],
                            resources: exporterResources,
                            readinessProbe: metricsProbe(9117),
                        },
                    ],
                },
            },
        },
    }, opts);
    const frontendService = new k8s.core.v1.Service("frontend", {
        metadata: {
            labels: frontendLabels,
            name: "frontend",
            namespace,
        },
        spec: {
            type: cfg.frontendServiceType,
            ports: [
                { name: "http", port: 80, targetPort: 80 },
                { name: "metrics", port: 9117, targetPort: "metrics" },
            ],
            selector: frontendLabels,
        },
    }, opts);

    return {
        namespace,
        redisLeaderDeployment,
        redisLeaderService,
        redisReplicaDeployment,
        redisReplicaService,
        frontendDeployment,
        frontendService,
    };
}
