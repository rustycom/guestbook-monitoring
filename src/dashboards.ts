import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import * as fs from "fs";
import * as path from "path";

// Dashboards as code: one ConfigMap per dashboards/*.json, picked up by the kps Grafana sidecar
// via the grafana_dashboard="1" label. The JSON stays a plain file so it can be edited/exported.
export function createDashboards(args: { provider: k8s.Provider; namespace: pulumi.Input<string> }) {
    const dir = path.join(__dirname, "..", "dashboards");
    return fs.readdirSync(dir).filter(f => f.endsWith(".json")).map(file => {
        const name = path.basename(file, ".json");
        return new k8s.core.v1.ConfigMap(`dashboard-${name}`, {
            metadata: { name: `dashboard-${name}`, namespace: args.namespace, labels: { grafana_dashboard: "1" } },
            data: { [file]: fs.readFileSync(path.join(dir, file), "utf8") },
        }, { provider: args.provider });
    });
}
