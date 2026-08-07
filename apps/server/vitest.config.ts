import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /**
     * Test files run one at a time.
     *
     * The integration suites each apply 002_rls.sql, which does CREATE ROLE and
     * GRANT — those write to CLUSTER-WIDE catalogs (pg_authid, pg_auth_members),
     * not to the per-test database. Two files migrating in parallel therefore
     * collide with `tuple concurrently updated`, which is a flaky CI failure
     * that has nothing to do with the code under test.
     *
     * The whole suite runs in about a second, so serialising costs nothing
     * worth measuring.
     */
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
