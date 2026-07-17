import { ownerEmail, ownerPassword, startN8nSession } from '../e2e/n8n-session.js';
import { customExtensionsDirectory } from '../e2e/test-target.js';

const session = await startN8nSession({ testTarget: 'out' });

console.info('');
console.info('n8n is running with DeepEval nodes from out/.');
console.info(`  URL:      ${session.context.baseUrl}`);
console.info(`  Email:    ${ownerEmail}`);
console.info(`  Password: ${ownerPassword}`);
console.info(`  Nodes:    ${customExtensionsDirectory('out')}`);
console.info(`  Data dir: ${session.userFolder}`);
console.info(`  Log:      ${session.logPath}`);
console.info('');
console.info('Press Ctrl+C to stop.');

const shutdown = async () => {
  console.info('\nShutting down n8n...');
  await session.teardown();
  process.exit(0);
};

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

await new Promise<void>(() => {
  // Keep the process alive until Ctrl+C.
});
