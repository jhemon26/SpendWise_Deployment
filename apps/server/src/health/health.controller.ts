import { Controller, Get } from '@nestjs/common';

/**
 * Unauthenticated liveness probe.
 *
 * Used by the Docker healthcheck and by the blue/green deploy script, which
 * waits for three consecutive passes before switching Nginx upstream
 * (ARCHITECTURE §12). Deliberately returns nothing about the database or
 * build — an unauthenticated endpoint should not be a reconnaissance tool.
 */
@Controller({ path: 'health', version: '1' })
export class HealthController {
  private readonly startedAt = Date.now();

  @Get()
  check(): { status: 'ok'; uptime_s: number } {
    return {
      status: 'ok',
      uptime_s: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }
}
