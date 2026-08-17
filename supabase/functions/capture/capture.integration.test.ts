// Integration test for the capture Edge Function handler.
//
// Runs the real `supabase/functions/capture/index.ts` handler against a fake
// Supabase HTTP server (auth + PostgREST + /functions/v1/style-profile), so the
// assertions are about the actual HTTP response the extension receives.
//
// Covers the two guarantees this slice ships:
//   1. the style-profile rebuild is off the synchronous response path — capture
//      answers 200 immediately even when every rebuild-trigger query is slow,
//      and the rebuild still fires afterwards (EdgeRuntime.waitUntil);
//   2. truthful error handling — an error after answers are inserted returns 200
//      with insertedIds, and only a capture that saved nothing returns 500.
//
// Run: deno test --allow-net --allow-env supabase/functions/capture/capture.integration.test.ts

import { assert, assertEquals } from 'jsr:@std/assert@1';

const FAKE_PORT = 54999;
const FAKE_URL = `http://127.0.0.1:${FAKE_PORT}`;

type ServerConfig = {
  /** ms of latency injected into every request made by the style-profile rebuild trigger */
  rebuildTriggerDelayMs: number;
  /** qa_pairs inserts whose question_label is in this set fail with a PostgREST error */
  failQaLabels: Set<string>;
};

const config: ServerConfig = {
  rebuildTriggerDelayMs: 0,
  failQaLabels: new Set(),
};

const log: string[] = [];
let qaSeq = 0;
let chunkSeq = 0;
let styleProfileTriggeredAt: number | null = null;
let startedAt = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rel = () => `+${String(Date.now() - startedAt).padStart(4, ' ')}ms`;
const note = (line: string) => {
  log.push(`${rel()}  ${line}`);
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const fakeSupabase = Deno.serve({ port: FAKE_PORT, onListen: () => {} }, async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;

  // ---- auth ----
  if (path === '/auth/v1/user') {
    return json({
      id: 'user-int-1',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'capture@example.test',
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    });
  }

  // ---- style-profile rebuild trigger (background) ----
  // count probes are HEAD requests (select(..., { count: 'exact', head: true }))
  if (req.method === 'HEAD' || path === '/rest/v1/style_profile') {
    note(`fake-supabase  <- rebuild-trigger query ${req.method} ${path} (sleeping ${config.rebuildTriggerDelayMs}ms)`);
    await sleep(config.rebuildTriggerDelayMs);
    if (req.method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: { 'Content-Range': '0-0/40', 'Content-Type': 'application/json' },
      });
    }
    return json([]);
  }

  if (path === '/functions/v1/style-profile') {
    styleProfileTriggeredAt = Date.now();
    note('fake-supabase  <- POST /functions/v1/style-profile  (background rebuild fired)');
    return json({ ok: true });
  }

  // ---- PostgREST ----
  if (path.startsWith('/rest/v1/')) {
    const table = path.slice('/rest/v1/'.length);

    if (req.method === 'GET') return json([]); // dedup candidates / max chunk_index

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      if (table === 'applications') return json({ id: 'app-int-1' }, 201);
      if (table === 'capture_mismatches') return json({ id: 'mm-1' }, 201);
      if (table === 'memory_chunks') return json({ id: `mc-${++chunkSeq}` }, 201);
      if (table === 'qa_pairs') {
        const label = (body as { question_label?: string }).question_label ?? '';
        if (config.failQaLabels.has(label)) {
          note(`fake-supabase  <- qa_pairs INSERT "${label}" -> 500 (simulated DB failure)`);
          return json({ message: 'simulated qa_pairs write failure', code: 'XX000' }, 500);
        }
        const id = `qa-${++qaSeq}`;
        note(`fake-supabase  <- qa_pairs INSERT "${label}" -> ${id}`);
        return json({ id }, 201);
      }
      return json({ id: 'row-1' }, 201);
    }
  }

  return json({ message: 'unhandled', path }, 404);
});

// ---- boot the capture function with Deno.serve stubbed so we can call its handler ----
Deno.env.set('SUPABASE_URL', FAKE_URL);
Deno.env.set('SUPABASE_ANON_KEY', 'fake-anon-key');

let captureHandler!: (req: Request) => Promise<Response> | Response;
const realServe = Deno.serve;
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (handler: any) => {
  captureHandler = handler;
  return { finished: Promise.resolve(), shutdown: () => Promise.resolve(), addr: { transport: 'tcp', hostname: '127.0.0.1', port: 0 } };
};
await import('./index.ts');
// deno-lint-ignore no-explicit-any
(Deno as any).serve = realServe;

// EdgeRuntime.waitUntil, as provided by the Supabase Edge Runtime.
const pendingBackground: Promise<unknown>[] = [];
// deno-lint-ignore no-explicit-any
(globalThis as any).EdgeRuntime = {
  waitUntil: (p: Promise<unknown>) => {
    note('EdgeRuntime.waitUntil(...) registered background task');
    pendingBackground.push(p);
  },
};

function captureRequest(answers: Array<{ questionLabel: string; answerText: string }>) {
  return new Request('http://capture.local/', {
    method: 'POST',
    headers: { Authorization: 'Bearer fake-jwt', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      application: { company: 'Acme Corp', roleTitle: 'Software Engineer', site: 'jobstreet.com', url: 'https://ph.jobstreet.com/job/1/apply' },
      answers: answers.map((a) => ({ ...a, draftText: null, fieldSelector: '#q', fieldId: 'q', mappingVerified: true })),
      mismatches: [],
    }),
  });
}

Deno.test('capture answers 200 immediately while the style-profile rebuild runs in the background', async () => {
  startedAt = Date.now();
  config.rebuildTriggerDelayMs = 800;
  config.failQaLabels = new Set();

  note('extension    -> POST capture  (2 verified answers)');
  const t0 = Date.now();
  const res = await captureHandler(captureRequest([
    { questionLabel: 'Why do you want to work here?', answerText: 'Your team ships the kind of tooling I already build for fun.' },
    { questionLabel: 'Describe a hard bug you fixed.', answerText: 'A race in our capture path that dropped writes under load.' },
  ]));
  const body = await res.json();
  const elapsed = Date.now() - t0;
  note(`extension    <- HTTP ${res.status} in ${elapsed}ms  ${JSON.stringify(body)}`);

  assertEquals(res.status, 200);
  assertEquals(body.ok, true);
  assertEquals(body.inserted, 2);
  assertEquals(body.insertedIds.length, 2);
  assertEquals(body.failedItems, 0);
  // The rebuild trigger alone costs >= 4 * 800ms; the save path must not wait for it.
  assert(elapsed < 500, `capture responded in ${elapsed}ms — style-profile rebuild is still blocking the response`);
  assertEquals(styleProfileTriggeredAt, null, 'rebuild fired before the response — it is not backgrounded');

  await Promise.all(pendingBackground.splice(0));
  // the rebuild POST itself is fire-and-forget inside the background task
  for (let i = 0; i < 50 && styleProfileTriggeredAt === null; i++) await sleep(20);
  note('background   -- waitUntil task settled');
  assert(styleProfileTriggeredAt !== null, 'background rebuild never fired');
  assert(styleProfileTriggeredAt! > t0 + elapsed, 'background rebuild did not run after the response');
});

Deno.test('a failure after some answers are saved returns 200 with insertedIds, never a 500', async () => {
  startedAt = Date.now();
  config.rebuildTriggerDelayMs = 0;
  config.failQaLabels = new Set(['Describe a hard bug you fixed.']);

  note('extension    -> POST capture  (2 answers; the 2nd write fails in the DB)');
  const res = await captureHandler(captureRequest([
    { questionLabel: 'Why do you want to work here?', answerText: 'Your team ships the kind of tooling I already build for fun.' },
    { questionLabel: 'Describe a hard bug you fixed.', answerText: 'A race in our capture path that dropped writes under load.' },
  ]));
  const body = await res.json();
  note(`extension    <- HTTP ${res.status}  ${JSON.stringify(body)}`);

  assertEquals(res.status, 200);
  assertEquals(body.ok, true);
  assertEquals(body.inserted, 1);
  assertEquals(body.insertedIds.length, 1);
  assertEquals(body.failedItems, 1);

  await Promise.all(pendingBackground.splice(0));
});

Deno.test('a capture that saved nothing still reports failure honestly (500)', async () => {
  startedAt = Date.now();
  config.rebuildTriggerDelayMs = 0;
  config.failQaLabels = new Set(['Why do you want to work here?']);

  note('extension    -> POST capture  (1 answer; its write fails in the DB)');
  const res = await captureHandler(captureRequest([
    { questionLabel: 'Why do you want to work here?', answerText: 'Your team ships the kind of tooling I already build for fun.' },
  ]));
  const body = await res.json();
  note(`extension    <- HTTP ${res.status}  ${JSON.stringify(body)}`);

  assertEquals(res.status, 500);
  assert(typeof body.error === 'string');

  await Promise.all(pendingBackground.splice(0));
});

Deno.test('transcript', async () => {
  console.log('\n--- capture Edge Function transcript ---\n' + log.join('\n') + '\n');
  const out = Deno.env.get('CAPTURE_TRANSCRIPT_OUT');
  if (out) await Deno.writeTextFile(out, log.join('\n') + '\n');
  await fakeSupabase.shutdown();
});
