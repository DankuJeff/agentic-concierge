import type { FastifyInstance, FastifyError } from 'fastify';
import { childLogger } from '../../shared/logger.js';

const log = childLogger({ module: 'error-handler' });

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode ?? 500;

    if (statusCode >= 500) {
      log.error(
        {
          err: error,
          method: request.method,
          url: request.url,
          statusCode,
        },
        'Unhandled server error',
      );
    }

    void reply.status(statusCode).send({
      ok: false,
      error: {
        code: error.code ?? 'INTERNAL_ERROR',
        message: statusCode >= 500 ? 'An unexpected error occurred' : error.message,
      },
    });
  });
}
