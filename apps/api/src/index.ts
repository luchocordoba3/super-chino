import { buildApp } from './app';
import { env } from './env';

const app = await buildApp();
await app.listen({ port: env.PORT, host: env.HOST });
