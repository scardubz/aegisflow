import { execSync } from 'child_process';

// After starting the container and setting process.env.TEST_DATABASE_URL:
try {
  console.log('[Testcontainers] Running ORM migrations...');
  // Pass the ephemeral connection URI directly to your ORM migration command
  execSync('npx drizzle-kit migrate', {
    env: { ...process.env, DATABASE_URL: connectionUri },
    stdio: 'inherit',
  });
} catch (error) {
  console.error('[Testcontainers] Migration command failed:', error);
  throw error;
}
