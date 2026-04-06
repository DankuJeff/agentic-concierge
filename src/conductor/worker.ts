/**
 * BullMQ worker entry point.
 * Run alongside the API server: npm run worker
 * Or run both together: npm run dev:all
 */

import '../shared/claude-client.js'; // ensures dotenv override runs before anything else
import { startWorker } from './dag-executor.js';
import { logger } from '../shared/logger.js';

logger.info('Starting DAG executor worker...');

const worker = startWorker();

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received — closing worker gracefully');
  await worker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received — closing worker gracefully');
  await worker.close();
  process.exit(0);
});
