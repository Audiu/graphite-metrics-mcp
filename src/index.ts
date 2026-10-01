#!/usr/bin/env node
import { createRequire } from 'node:module';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { ConfigError, loadConfig } from './config.js';
import { GraphiteClient } from './graphite.js';
import { createServer } from './server.js';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

try {
    const client = new GraphiteClient(loadConfig());
    serveStdio(() => createServer(client, version), {
        onerror: (error) => console.error('[graphite-metrics-mcp]', error),
    });
} catch (error) {
    if (error instanceof ConfigError) {
        console.error(`[graphite-metrics-mcp] ${error.message}`);
        process.exit(1);
    }
    throw error;
}
