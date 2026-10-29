// Composition root: wire modules together and export stack outputs. No resources defined here.
import { config } from "./src/config";
import { createProvider } from "./src/provider";
import { createGuestbook } from "./src/guestbook";
import { createMonitoring } from "./src/monitoring";

const provider = createProvider(config);
const guestbook = createGuestbook({ provider, config });
const monitoring = createMonitoring({ provider, config });

export const frontendClusterIp = guestbook.frontendService.spec.clusterIP;
export const grafanaUrl = monitoring.grafanaUrl;
export const grafanaAdminUser = monitoring.grafanaAdminUser;
export const grafanaAdminPassword = monitoring.grafanaAdminPassword;
export const prometheusPortForward =
    `kubectl --context ${config.kubeContext} -n monitoring port-forward svc/kps-prometheus 9090:9090`;
