import * as pulumi from "@pulumi/pulumi";

const c = new pulumi.Config();

export const config = {
    // Required, never defaulted: we must not fall back to whatever the ambient kube context is.
    kubeContext: c.require("kubeContext"),
    frontendServiceType: c.get("frontendServiceType") ?? "ClusterIP",
    images: {
        // Upstream only publishes `latest`; pinned by digest.
        frontend:
            "pulumi/guestbook-php-redis@sha256:f21cbff35c0bad29d0c480f741e19919fb135d7c7941b8b5fc7240503d0a1c4f",
        // Leader and replica share one pinned image (see README "Upstream issue found").
        redis: "redis:8.10.3",
    },
};

export type Config = typeof config;
