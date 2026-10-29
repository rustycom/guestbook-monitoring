// Composition root: wire modules together and export stack outputs. No resources defined here.
import { config } from "./src/config";
import { createProvider } from "./src/provider";
import { createGuestbook } from "./src/guestbook";

const provider = createProvider(config);
const guestbook = createGuestbook({ provider, config });

export const frontendClusterIp = guestbook.frontendService.spec.clusterIP;
