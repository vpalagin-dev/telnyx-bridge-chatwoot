import { loadConfig } from './config/env.js';
import { buildRuntime } from './runtime.js';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  if (config.runtimeRole !== 'web') throw new Error('Web service requires RUNTIME_ROLE=web');
  const app = buildRuntime(config);
  await app.listen({ host: config.server.host, port: config.server.port });
}

main().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : 'StartupError';
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Bridge startup failed (${name}): ${message}\n`);
  process.exitCode = 1;
});
