// test/setup.ts
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

let pgContainer: StartedPostgreSqlContainer;
let redisContainer: StartedRedisContainer;

export default async function setup() {
  // 1. Spin up both Postgres and Redis containers in parallel
  [pgContainer, redisContainer] = await Promise.all([
    new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('test_db')
      .withUsername('postgres')
      .withPassword('postgres')
      .start(),
    new RedisContainer('redis:7.2-alpine').start(),
  ]);

  // 2. Inject dynamic connection strings into process.env
  process.env.TEST_DATABASE_URL = pgContainer.getConnectionUri();
  process.env.TEST_REDIS_URL = redisContainer.getConnectionUrl();

  // 3. Execute database migrations
  const migrationPool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  try {
    const migrationsDir = path.resolve(__dirname, '../db/migrations');
    if (fs.existsSync(migrationsDir)) {
      const files = fs.readdirSync(migrationsDir)
        .filter(file => file.endsWith('.sql'))
        .sort();

      for (const file of files) {
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        await migrationPool.query(sql);
      }
    }
  } finally {
    await migrationPool.end();
  }

  // 4. Return teardown hook for Vitest
  return async () => {
    await Promise.all([
      pgContainer.stop(),
      redisContainer.stop(),
    ]);
  };
}
