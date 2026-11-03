#!/usr/bin/env bun
import path from 'node:path';
import { start } from './server.ts';

const env = process.env;
start({ home: env.SNOWMOBILE_HOME || undefined, port: env.PORT ? Number(env.PORT) : undefined,
  claude: env.SNOWMOBILE_CLAUDE || undefined }).then(({ cfg, port }) => {
  console.log(`snowmobile: http://127.0.0.1:${port}/?token=${cfg.token}`);
  console.log(`database:   ${path.join(cfg.home, 'snowmobile.db')}`);
  console.log(`phone:      ssh -L ${port}:127.0.0.1:${port} <this-machine>, then open the same URL`);
}, (e: Error) => { console.error(`snowmobile: ${e.message}`); process.exit(1); });
