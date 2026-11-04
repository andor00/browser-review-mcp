import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PORT } from '@brm/shared';

export interface Config {
  port: number;
  host: string;
  dataDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.BRM_PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`BRM_PORT is not a valid port: ${env.BRM_PORT}`);
  }
  const dataHome = env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  return {
    port,
    // Loopback only. Never make this configurable to 0.0.0.0.
    host: '127.0.0.1',
    dataDir: env.BRM_DATA_DIR || join(dataHome, 'browser-review-mcp'),
  };
}
