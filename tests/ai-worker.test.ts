/**
 * The one door out of the app: what it sends, what it accepts back, and what
 * each way of failing is called.
 *
 * Everything here runs against a stubbed `fetch`, because the point is the
 * contract with our Worker rather than the Worker itself — the half that breaks
 * silently if a field moves, and the half that must never hand a screen
 * `undefined` to write into a file.
 */
import { AiError, failureForStatus, postToWorker, resultFromResponse } from '@/lib/ai-worker';

import { check, group } from './harness';

group('Odczyt koperty');

check(
  'wynik wyjmowany z koperty',
  resultFromResponse({ result: { image: 'BASE64' }, success: true, errors: [] }).image,
  'BASE64'
);

/** Runs `resultFromResponse` and reports which failure it raised. */
const failure = (label: string, body: unknown, expected: string) =>
  check(
    label,
    (() => {
      try {
        resultFromResponse(body);
        return 'nie odmowil';
      } catch (error) {
        return error instanceof AiError ? error.failure : String(error);
      }
    })(),
    expected
  );

// The envelope can say 200 with `success: false`, so the status code alone is
// not the whole truth.
failure('odmowa mimo HTTP 200', { success: false, errors: [{ message: 'blocked' }] }, 'provider');
failure('brak wyniku', { success: true }, 'malformed');
failure('cos, co nie jest obiektem', 'nope', 'malformed');
failure('null', null, 'malformed');

check(
  'komunikat niesie slowa Workera',
  new AiError('provider', 'blocked').message.includes('blocked'),
  true
);

group('Co znacza kody HTTP');

check('401 to odrzucona aplikacja', failureForStatus(401), 'unauthorized');
check('403 tez', failureForStatus(403), 'unauthorized');
check('429 to wyczerpany limit', failureForStatus(429), 'rate-limited');
check('500 to problem po stronie generatora', failureForStatus(500), 'provider');

group('Czego generator nie sprobuje');

/** The failure `postToWorker` rejects with, without ever reaching the network. */
async function refusal(workerUrl: string) {
  try {
    await postToWorker('/image', { prompt: 'x' }, workerUrl);
    return 'nie odmowil';
  } catch (error) {
    return error instanceof AiError ? error.failure : String(error);
  }
}

// A build shipped without an address for its Worker must say so rather than
// call nowhere. The guard runs before `fetch`, so this needs no network.
check('bez adresu Workera nie dzwoni', await refusal(''), 'not-configured');
check('sam bialy znak to tez brak adresu', await refusal('   '), 'not-configured');

group('O co aplikacja prosi Workera');

export type Sent = { url: string; init: RequestInit };

/** Runs `call` against a stubbed `fetch` and reports both sides of it. */
export async function withStub<T>(
  reply: { status: number; body: unknown },
  call: () => Promise<T>
): Promise<{ sent: Sent | null; outcome: string }> {
  const real = globalThis.fetch;
  let sent: Sent | null = null;

  globalThis.fetch = ((url: string, init: RequestInit) => {
    sent = { url, init };

    return Promise.resolve({
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: () => Promise.resolve(reply.body),
    } as Response);
  }) as typeof fetch;

  try {
    // Awaited into a variable first, on purpose: an object literal evaluates its
    // properties left to right, so `{ sent, outcome: await call() }` would read
    // `sent` before the call had run and report null every time.
    const outcome = String(await call());

    return { sent, outcome };
  } catch (error) {
    return { sent, outcome: error instanceof AiError ? error.failure : String(error) };
  } finally {
    globalThis.fetch = real;
  }
}

const posted = await withStub({ status: 200, body: { success: true, result: { ok: 1 } } }, () =>
  postToWorker('/mnemonic', { term: 'comer' }, 'https://w.example.dev')
);

check('sciezka doklejana do adresu', posted.sent?.url, 'https://w.example.dev/mnemonic');
check('metoda POST', posted.sent?.init.method, 'POST');

// A trailing slash on the configured address must not produce a double one.
const slashed = await withStub({ status: 200, body: { success: true, result: {} } }, () =>
  postToWorker('/image', {}, 'https://w.example.dev/')
);

check('ukosnik na koncu adresu nie dubluje sie', slashed.sent?.url, 'https://w.example.dev/image');

// No key travels any more — that is the entire point of the Worker. A header
// creeping back in here would mean a token had crept back into the bundle.
const headers = (posted.sent?.init.headers ?? {}) as Record<string, string>;

check('bez naglowka Authorization', 'Authorization' in headers, false);

check(
  'odmowa Workera to nie blad sieci',
  (
    await withStub({ status: 403, body: { success: false, errors: [{ message: 'Bad app secret.' }] } }, () =>
      postToWorker('/image', {}, 'https://w.example.dev')
    )
  ).outcome,
  'unauthorized'
);

check(
  'wyczerpany limit ma wlasna nazwe',
  (
    await withStub({ status: 429, body: { success: false, errors: [{ message: 'quota' }] } }, () =>
      postToWorker('/image', {}, 'https://w.example.dev')
    )
  ).outcome,
  'rate-limited'
);
