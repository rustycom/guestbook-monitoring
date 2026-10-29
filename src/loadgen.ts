import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { Config } from "./config";

// Synthetic traffic through Traefik, so every dashboard panel has data on first open.
// Per 7 s (14 ticks of 0.5 s): 14× GET /, ~3× read, ~1× write and 1× GET of a missing page,
// i.e. ~5% deliberate 404s for the 4xx panel. It uses its own Redis key (`loadgen`), so it never
// overwrites messages typed into the guestbook UI, and the value is fixed so memory stays flat.
const script = `
target=http://traefik.traefik.svc.cluster.local
i=0
while true; do
  curl -s -o /dev/null "$target/"
  [ $((i % 4)) -eq 0 ] && curl -s -o /dev/null "$target/guestbook.php?cmd=get&key=loadgen"
  [ $((i % 20)) -eq 0 ] && curl -s -o /dev/null "$target/guestbook.php?cmd=set&key=loadgen&value=hello%2Cfrom%20loadgen"
  [ $((i % 14)) -eq 0 ] && curl -s -o /dev/null "$target/does-not-exist"
  i=$((i + 1))
  sleep 0.5
done
`;

export function createLoadgen(args: {
    provider: k8s.Provider;
    config: Config;
    namespace: pulumi.Input<string>;
    dependsOn: pulumi.Resource[];
}) {
    const { config: cfg } = args;
    if (!cfg.loadgen.enabled) return undefined;

    const labels = { app: "loadgen" };
    return new k8s.apps.v1.Deployment("guestbook-loadgen", {
        metadata: { name: "guestbook-loadgen", namespace: args.namespace, labels },
        spec: {
            replicas: 1,
            selector: { matchLabels: labels },
            template: {
                metadata: { labels },
                spec: {
                    // Default ndots:5 sends the FQDN through every search domain first (~0.8 s/request).
                    dnsConfig: { options: [{ name: "ndots", value: "1" }] },
                    containers: [{
                        name: "loadgen",
                        image: cfg.images.curl,
                        command: ["/bin/sh", "-c", script],
                        resources: {
                            requests: { cpu: "5m", memory: "8Mi" },
                            limits: { cpu: "50m", memory: "32Mi" },
                        },
                    }],
                },
            },
        },
    }, { provider: args.provider, dependsOn: args.dependsOn });
}
