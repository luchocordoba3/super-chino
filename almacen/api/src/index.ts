import { buildApp } from './app';
import { env } from './env';
import { startJobs } from './services/jobs';

const app = await buildApp();
await app.listen({ port: env.PORT, host: env.HOST });
if (env.JOBS_ENABLED) startJobs(app.log);
