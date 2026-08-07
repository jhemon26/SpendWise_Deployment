import { SetMetadata, CustomDecorator } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'spendwise:isPublic';

/**
 * Opt a route out of the global AuthGuard.
 *
 * Deliberately an explicit annotation rather than a list of excluded paths in
 * the guard: the exemption lives next to the handler it applies to, so it is
 * visible in review and cannot silently widen when a route is renamed.
 */
export const Public = (): CustomDecorator<string> => SetMetadata(IS_PUBLIC_KEY, true);
