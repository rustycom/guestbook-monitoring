// Composition root: wire modules together and export stack outputs. No resources defined here.
import { config } from "./src/config";
import { createProvider } from "./src/provider";
import { createGuestbook } from "./src/guestbook";
import { createMonitoring } from "./src/monitoring";
import { createServiceMonitors } from "./src/servicemonitors";
import { createEdge } from "./src/edge";
import { createLoadgen } from "./src/loadgen";
import { createDashboards } from "./src/dashboards";
import { createAlerts } from "./src/alerts";

const provider = createProvider(config);
const guestbook = createGuestbook({ provider, config });
const monitoring = createMonitoring({ provider, config });
createServiceMonitors({ provider, namespace: guestbook.namespace, dependsOn: [monitoring.release] });
const edge = createEdge({
    provider, config, guestbookNamespace: guestbook.namespace, dependsOn: [monitoring.release],
});
createAlerts({ provider, namespace: guestbook.namespace, dependsOn: [monitoring.release] });
createDashboards({ provider, namespace: monitoring.namespace });
createLoadgen({ provider, config, namespace: guestbook.namespace, dependsOn: [edge.release] });

export const guestbookUrl = edge.guestbookUrl;

export const frontendClusterIp = guestbook.frontendService.spec.clusterIP;
export const grafanaUrl = monitoring.grafanaUrl;
export const grafanaDashboardUrl = monitoring.grafanaUrl.apply(u => `${u}/d/guestbook-overview`);
export const grafanaAdminUser = monitoring.grafanaAdminUser;
export const grafanaAdminPassword = monitoring.grafanaAdminPassword;
export const prometheusPortForward =
    `kubectl --context ${config.kubeContext} -n monitoring port-forward svc/kps-prometheus 9090:9090`;
