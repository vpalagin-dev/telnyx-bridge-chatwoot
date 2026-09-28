import { loadConfig } from './config/env.js';
import { buildRuntime } from './runtime.js';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const app = buildRuntime(config);
  await app.listen({ host: config.server.host, port: config.server.port });
}

main().catch(() => {
  process.stderr.write('Bridge startup failed; check sanitized configuration and service availability.\n');
  process.exitCode = 1;
});
