import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import { Config } from "./config";

export function createMonitoring(args: { provider: k8s.Provider; config: Config }) {
    const { provider, config: cfg } = args;
    const opts = { provider };

    const ns = new k8s.core.v1.Namespace("monitoring", { metadata: { name: "monitoring" } }, opts);
    const namespace = ns.metadata.name;

    // Generated admin password instead of the chart default (admin/prom-operator), since Grafana is
    // exposed outside the cluster. Lives only in Pulumi state (encrypted) and the k8s Secret.
    const password = new random.RandomPassword("grafana-admin", { length: 24, special: false });
    const adminUser = "admin";
    const secret = new k8s.core.v1.Secret("grafana-admin", {
        metadata: { name: "grafana-admin", namespace },
        stringData: { "admin-user": adminUser, "admin-password": password.result },
    }, opts);

    const release = new k8s.helm.v3.Release("kps", {
        name: "kps", // → `release: kps` label, which the chart's default selectors match on
        chart: "kube-prometheus-stack",
        version: cfg.charts.kubePrometheusStack.version,
        repositoryOpts: { repo: cfg.charts.kubePrometheusStack.repo },
        namespace,
        timeout: 900,
        atomic: true,
        values: {
            fullnameOverride: "kps",
            grafana: {
                fullnameOverride: "grafana",
                admin: { existingSecret: secret.metadata.name, userKey: "admin-user", passwordKey: "admin-password" },
                service: { type: "ClusterIP" }, // external exposure is grafana-external below
                sidecar: { dashboards: { enabled: true, label: "grafana_dashboard", labelValue: "1" } },
                "grafana.ini": { "auth.anonymous": { enabled: false } },
            },
            prometheus: {
                prometheusSpec: {
                    // Without these, Prometheus only selects ServiceMonitors/rules labelled
                    // `release: kps` — the classic "empty Targets page" trap. We also set that
                    // label on everything we create, so either safeguard alone is sufficient.
                    serviceMonitorSelectorNilUsesHelmValues: false,
                    podMonitorSelectorNilUsesHelmValues: false,
                    ruleSelectorNilUsesHelmValues: false,
                    retention: "2d",
                    scrapeInterval: "15s",
                },
            },
            // kind binds these control-plane components to 127.0.0.1, so they would show up as
            // permanently-down targets with firing alerts. Disabled to keep Targets meaningful.
            kubeEtcd: { enabled: false },
            kubeControllerManager: { enabled: false },
            kubeScheduler: { enabled: false },
            kubeProxy: { enabled: false },
            alertmanager: {
                alertmanagerSpec: { resources: { requests: { cpu: "10m", memory: "32Mi" } } },
            },
        },
    }, { ...opts, dependsOn: [secret] });

    const nodePort = cfg.exposeAs === "NodePort";
    const grafanaExternal = new k8s.core.v1.Service("grafana-external", {
        metadata: {
            name: "grafana-external",
            namespace,
            annotations: !nodePort && cfg.skipLbAwait ? { "pulumi.com/skipAwait": "true" } : undefined,
        },
        spec: {
            type: cfg.exposeAs,
            selector: { "app.kubernetes.io/name": "grafana", "app.kubernetes.io/instance": "kps" },
            ports: [{
                name: "http",
                port: 80,
                targetPort: 3000,
                nodePort: nodePort ? cfg.nodePorts.grafana : undefined,
            }],
        },
    }, { ...opts, dependsOn: [release] });

    const grafanaUrl = nodePort
        ? pulumi.output(`http://${cfg.nodeHost}:${cfg.nodePorts.grafana}`)
        : grafanaExternal.status.loadBalancer.ingress.apply(ing => {
            const addr = ing?.[0]?.ip ?? ing?.[0]?.hostname;
            return addr ? `http://${addr}` : "pending — run: pulumi up --refresh";
        });

    return {
        namespace,
        release,
        grafanaUrl,
        grafanaAdminUser: adminUser,
        grafanaAdminPassword: pulumi.secret(password.result),
    };
}
