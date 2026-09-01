import { buildHealth } from "./server.mjs";

const health = buildHealth();
console.log(JSON.stringify(health, null, 2));
if (!health.capabilities.meshVerification) process.exitCode = 1;
