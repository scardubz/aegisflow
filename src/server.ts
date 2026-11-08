import { buildApp } from './app';

async function startServer() {
  try {
    const app = await buildApp();
    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
    const host = process.env.HOST || '0.0.0.0';

    await app.listen({ port, host });
    app.log.info(`AegisFlow server running successfully on http://${host}:${port}`);
  } catch (err) {
    console.error('Failed to start AegisFlow server:', err);
    process.exit(1);
  }
}

startServer();
