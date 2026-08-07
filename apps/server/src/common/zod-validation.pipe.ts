import { PipeTransform, Injectable, BadRequestException, ArgumentMetadata } from '@nestjs/common';
import { ZodError, ZodSchema } from 'zod';

/**
 * Validates a request payload against a zod schema from `@spendwise/shared-types`.
 *
 * Nest's built-in ValidationPipe wants class-validator decorators, which would
 * mean defining every DTO twice — once as a zod schema the client uses, once as
 * a decorated class the server uses. Those two definitions drift, and the sync
 * protocol is precisely where drift corrupts data (ARCHITECTURE §2). One schema,
 * both ends.
 *
 * zod's `.parse()` strips unknown keys by default, which is the behaviour §7.2
 * asks for: unknown input is dropped, never forwarded into a query.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    try {
      return this.schema.parse(value);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException({
          type: 'https://spendwise.app/problems/validation',
          title: 'Request validation failed',
          status: 400,
          errors: err.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        });
      }
      throw err;
    }
  }
}

/** Convenience: `@Body(zodBody(transactionSchema)) tx: Transaction` */
export const zodBody = (schema: ZodSchema): ZodValidationPipe => new ZodValidationPipe(schema);
