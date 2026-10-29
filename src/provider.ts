import * as k8s from "@pulumi/kubernetes";
import { Config } from "./config";

// Every Kubernetes resource goes through this provider, pinned to an explicit context.
export function createProvider(cfg: Config): k8s.Provider {
    return new k8s.Provider("kind", { context: cfg.kubeContext, enableServerSideApply: true });
}
