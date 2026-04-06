import '../shared/claude-client.js'; // ensures dotenv override runs before anything else
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { childLogger } from '../shared/logger.js';
import { registerErrorHandler } from './middleware/error-handler.js';
import { requireAuth } from './middleware/requireAuth.js';
import { authRoutes } from './routes/auth.js';
import { chatRoutes } from './routes/chat.js';
import { documentRoutes } from './routes/documents.js';
import { taskRoutes } from './routes/tasks.js';
import { workflowRoutes } from './routes/workflows.js';
import { integrationRoutes } from './routes/integrations.js';
import { billingRoutes, stripeWebhookRoute } from './routes/billing.js';
import { plaidRoutes } from './routes/plaid.js';
import { analyticsRoutes } from './routes/analytics.js';
import { waitlistRoutes } from './routes/waitlist.js';
import { startWorker, resumeActiveWorkflows } from '../conductor/dag-executor.js';

const log = childLogger({ module: 'server' });
const PORT = parseInt(process.env['PORT'] ?? '3000', 10);

async function build() {
  const app = Fastify({
    bodyLimit: 20 * 1024 * 1024, // 20MB — supports large PDF/DOCX base64 uploads
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
      transport:
        process.env['NODE_ENV'] !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
  });

  // CORS — allow the frontend dev server and same-origin requests.
  // credentials: true is required so the browser sends the session cookie cross-origin.
  await app.register(cors, {
    origin: [process.env['FRONTEND_ORIGIN'] ?? 'http://localhost:5173', 'http://localhost:3000'],
    credentials: true,
  });

  // Rate limiting — 100 req/min per IP by default.
  // Individual routes can override via config.rateLimit (e.g. auth routes use 10/min).
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      ok: false,
      error: { code: 'RATE_LIMITED', message: 'Too many requests — please slow down.' },
    }),
  });

  registerErrorHandler(app);

  // Health check — unprotected, no rate limit overhead
  app.get('/health', { config: { rateLimit: false } }, async () => ({
    ok: true,
    timestamp: new Date().toISOString(),
  }));

  // In production, serve the built React frontend and handle SPA client-side routing.
  // In development, the Vite dev server on :5173 handles the frontend with HMR.
  if (process.env['NODE_ENV'] === 'production') {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const frontendDist = join(__dirname, '../../frontend/dist');

    // wildcard: true (default) — @fastify/static adds a GET /* route that tries to
    // serve static files. When a file isn't found it calls next(), falling through
    // to setNotFoundHandler which serves index.html for SPA client-side routes.
    await app.register(fastifyStatic, {
      root: frontendDist,
      prefix: '/',
      decorateReply: true,
    });

    // SPA fallback: non-API 404s serve index.html for client-side routing.
    // API routes that don't exist still return JSON 404s.
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api')) {
        return reply.status(404).send({
          ok: false,
          error: { code: 'NOT_FOUND', message: `Route ${request.url} not found.` },
        });
      }
      return reply.sendFile('index.html');
    });
  }

  // Stripe webhook — unprotected (called by Stripe servers, not users).
  // rawBody capture is scoped inside stripeWebhookRoute to avoid overriding
  // the JSON parser globally for all routes.
  await app.register(stripeWebhookRoute);

  // Waitlist routes — unprotected (public landing page form submissions)
  await app.register(waitlistRoutes);

  // Auth routes — unprotected (handles login/logout, cannot require auth to log in)
  await app.register(authRoutes);

  // Protected routes — all require a valid session cookie.
  // Fastify's scoped plugin model: requireAuth is a preHandler on this scope only.
  await app.register(async (protected_) => {
    protected_.addHook('preHandler', requireAuth);
    await protected_.register(chatRoutes);
    await protected_.register(documentRoutes);
    await protected_.register(taskRoutes);
    await protected_.register(workflowRoutes);
    await protected_.register(integrationRoutes);
    await protected_.register(billingRoutes);
    await protected_.register(plaidRoutes);
    await protected_.register(analyticsRoutes);
  });

  return app;
}

async function start() {
  try {
    const app = await build();
    await app.listen({ port: PORT, host: '0.0.0.0' });
    log.info({ port: PORT }, 'Server started');

    // Start the BullMQ worker in-process so it shares the workflowEvents emitter with the
    // SSE route. Phase 4 note: extract back to separate worker process and replace
    // workflowEvents with Redis pub/sub when deploying multi-process.
    startWorker();
    log.info('BullMQ worker started in-process');

    // Re-enqueue any tasks that were mid-flight when the server last shut down.
    await resumeActiveWorkflows();
    log.info('Workflow resumption check complete');
  } catch (err) {
    log.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}

start();
