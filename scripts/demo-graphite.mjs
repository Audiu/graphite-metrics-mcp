#!/usr/bin/env node
// Starts a throwaway Graphite in Docker and fills it with 6 hours of demo metrics, so the MCP server can be
// tried without access to a real Graphite. Run with --stop to remove it.
import { execFileSync } from 'node:child_process';
import net from 'node:net';

const NAME = 'graphite-metrics-mcp-demo';
const HTTP_PORT = Number(process.env.GRAPHITE_DEMO_HTTP_PORT ?? 8080);
const CARBON_PORT = Number(process.env.GRAPHITE_DEMO_CARBON_PORT ?? 2003);
const URL = `http://localhost:${HTTP_PORT}`;

function docker(...args) {
    return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

if (process.argv.includes('--stop')) {
    docker('rm', '-f', NAME);
    console.log(`Removed ${NAME}.`);
    process.exit(0);
}

try {
    docker('info', '--format', '{{.ServerVersion}}');
} catch {
    console.error('Docker is not running. Start Docker and try again.');
    process.exit(1);
}

const running = docker('ps', '-q', '--filter', `name=^${NAME}$`);
if (!running) {
    docker('rm', '-f', NAME);
    console.log(`Starting ${NAME} (graphiteapp/graphite-statsd)...`);
    docker(
        'run',
        '-d',
        '--name',
        NAME,
        '-p',
        `${HTTP_PORT}:80`,
        '-p',
        `${CARBON_PORT}:2003`,
        'graphiteapp/graphite-statsd',
    );
}

process.stdout.write('Waiting for graphite-web');
for (let attempt = 0; ; attempt++) {
    try {
        const response = await fetch(`${URL}/metrics/find?query=*`);
        if (response.ok) break;
    } catch {
        // not up yet
    }
    if (attempt > 90) {
        console.error(`\ngraphite-web did not come up on ${URL}. Check: docker logs ${NAME}`);
        process.exit(1);
    }
    process.stdout.write('.');
    await new Promise((resolve) => setTimeout(resolve, 1000));
}
console.log(' ready.');

// Default retention in the image is 10s:6h,1m:6d,10m:1800d, so seed the 10s window.
const STEP = 10;
const end = Math.floor(Date.now() / 1000 / STEP) * STEP;
const start = end - 6 * 3600;
const lines = [];
const random = (min, max) => min + Math.random() * (max - min);

for (let ts = start; ts <= end; ts += STEP) {
    const i = (ts - start) / STEP;
    for (const host of ['web1', 'web2', 'web3']) {
        // web2 has a traffic spike, then a latency incident, two hours ago.
        const incident = host === 'web2' && ts > end - 2 * 3600 && ts < end - 2 * 3600 + 900;
        lines.push(`demo.app.${host}.requests.count ${Math.round(random(20, 60) + (incident ? 150 : 0))} ${ts}`);
        lines.push(
            `demo.app.${host}.latency.p95 ${(120 + 40 * Math.sin(i / 60) + random(0, 15) + (incident ? 400 : 0)).toFixed(2)} ${ts}`,
        );
        lines.push(
            `demo.app.${host}.errors.count ${incident ? Math.round(random(5, 20)) : Math.random() < 0.02 ? 1 : 0} ${ts}`,
        );
    }
    lines.push(`demo.users.sign-ups.count ${Math.random() < 0.3 ? Math.round(random(1, 3)) : 0} ${ts}`);
    lines.push(`demo.queue.depth ${Math.round(50 + 30 * Math.sin(i / 200) + random(0, 10))} ${ts}`);
}

await new Promise((resolve, reject) => {
    const socket = net.createConnection(CARBON_PORT, 'localhost', () => socket.end(`${lines.join('\n')}\n`, resolve));
    socket.on('error', reject);
});

console.log(`Sent ${lines.length} datapoints under demo.* (carbon may take ~10s to write them).

Graphite: ${URL}

Try it:
  GRAPHITE_URL=${URL} npm run inspect
  claude mcp add graphite-demo -e GRAPHITE_URL=${URL} -- node ${process.cwd()}/dist/index.js

Stop it:
  npm run demo:graphite -- --stop`);
