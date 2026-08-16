import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveFixturesDir(): string {
  const candidates = [
    path.resolve(process.cwd(), 'apps/extension/e2e/fixtures'),
    path.resolve(process.cwd(), 'e2e/fixtures'),
    path.resolve(__dirname, '../fixtures'),
    path.resolve(__dirname, '../../e2e/fixtures'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isDirectory()) {
      return c;
    }
  }
  throw new Error(`Fixtures directory not found in candidates: ${candidates.join(', ')}`);
}

export const FIXTURES_DIR = resolveFixturesDir();

export interface FixtureServer {
  server: http.Server;
  port: number;
  close: () => Promise<void>;
}

export function startFixtureServer(port = 0): Promise<FixtureServer> {
  const fixturesDir = resolveFixturesDir();

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      console.log('[FIXTURE SERVER]:', req.method, req.url, 'Host:', req.headers.host);
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', '*');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (pathname.includes('role-requirements')) {
        const file = path.join(fixturesDir, 'jobstreet-role-requirements.html');
        if (fs.existsSync(file)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(fs.readFileSync(file));
          return;
        }
      }

      if (pathname.includes('jobstreet') || (pathname.includes('apply') && !pathname.includes('indeed') && !pathname.includes('generic') && !pathname.includes('linkedin'))) {
        const file = path.join(fixturesDir, 'jobstreet-apply.html');
        if (fs.existsSync(file)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(fs.readFileSync(file));
          return;
        }
      }

      if (pathname.includes('indeed') || pathname.includes('questions-module')) {
        const file = path.join(fixturesDir, 'indeed-apply.html');
        if (fs.existsSync(file)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(fs.readFileSync(file));
          return;
        }
      }

      if (pathname.includes('linkedin') || pathname.includes('easy-apply') || pathname.includes('jobs/view')) {
        const file = path.join(fixturesDir, 'linkedin-easy-apply.html');
        if (fs.existsSync(file)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(fs.readFileSync(file));
          return;
        }
      }

      if (pathname.includes('generic')) {
        const file = path.join(fixturesDir, 'generic-apply.html');
        if (fs.existsSync(file)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(fs.readFileSync(file));
          return;
        }
      }

      if (pathname.includes('submit-success')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!DOCTYPE html><html><body><h1>Application Submitted Successfully</h1></body></html>');
        return;
      }

      // Default fallback: check if file exists in fixtures
      const directFile = path.join(fixturesDir, pathname.replace(/^\//, ''));
      if (fs.existsSync(directFile) && fs.statSync(directFile).isFile()) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(directFile));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Not Found: ${pathname} in ${fixturesDir}`);
    });

    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      resolve({
        server,
        port: actualPort,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });

    server.on('error', reject);
  });
}
