/**
 * The half of the picture generator that has no device in it: what gets asked
 * for, what comes back, and what each failure is called.
 *
 * This is where a change at the other end would show up first — the response is
 * read by field name, and a field that moved would otherwise hand a screen
 * `undefined` to write into a file. The request itself is exercised against a
 * stubbed `fetch`, because the one thing worth pinning down after moving to our
 * own Worker is that the app still asks for what the Worker expects.
 */
import {
  AiImageError,
  buildPrompt,
  failureForStatus,
  generateImage,
  imageFromResponse,
} from '@/lib/ai-image';

import { check, group } from './harness';

group('Prompt do generatora');

const prompt = buildPrompt('  to   break  ');

check('hasło trafia do promptu', prompt.includes('to break'), true);
check('i jest scisniete ze spacji', prompt.includes('to   break'), false);
// Image models like writing words into pictures, and a misspelt word on a
// vocabulary card teaches the misspelling.
check('prompt zabrania tekstu na obrazie', prompt.includes('No text'), true);
check('mieści się w limicie Cloudflare', buildPrompt('x'.repeat(5000)).length <= 2048, true);

group('Odczyt odpowiedzi generatora');

check(
  'obraz wyjmowany z koperty',
  imageFromResponse({ result: { image: 'BASE64' }, success: true, errors: [] }),
  'BASE64'
);

/** Runs `read` and reports which failure it raised, or what it returned instead. */
const failure = (label: string, body: unknown, expected: string) =>
  check(
    label,
    (() => {
      try {
        return imageFromResponse(body);
      } catch (error) {
        return error instanceof AiImageError ? error.failure : String(error);
      }
    })(),
    expected
  );

// The envelope can say 200 with `success: false`, so the status code alone is
// not the whole truth.
failure('odmowa mimo HTTP 200', { success: false, errors: [{ message: 'blocked' }] }, 'provider');
failure('brak obrazu w wyniku', { result: {}, success: true }, 'malformed');
failure('pusty obraz to tez brak', { result: { image: '' }, success: true }, 'malformed');
failure('cos, co nie jest obiektem', 'nope', 'malformed');
failure('null', null, 'malformed');

check(
  'komunikat niesie slowa generatora',
  new AiImageError('provider', 'blocked').message.includes('blocked'),
  true
);

group('Co znacza kody HTTP');

check('401 to odrzucona aplikacja', failureForStatus(401), 'unauthorized');
check('403 tez', failureForStatus(403), 'unauthorized');
check('429 to wyczerpany limit', failureForStatus(429), 'rate-limited');
check('500 to problem po stronie generatora', failureForStatus(500), 'provider');

group('Czego generator nie sprobuje');

/** The failure `generateImage` rejects with, without ever reaching the network. */
async function refusal(term: string, workerUrl: string) {
  try {
    await generateImage(term, workerUrl);
    return 'nie odmowil';
  } catch (error) {
    return error instanceof AiImageError ? error.failure : String(error);
  }
}

// Both guards run before `fetch`, so these tests need no network. A build
// shipped without an address for its Worker must say so rather than call
// nowhere.
check('bez adresu Workera nie dzwoni', await refusal('pies', ''), 'not-configured');
check('sam bialy znak to tez brak adresu', await refusal('pies', '   '), 'not-configured');
check('z pustym haslem tez nie', await refusal('   ', 'https://w.example.dev'), 'empty-prompt');

group('O co generator prosi Workera');

/** What the last stubbed `fetch` was called with. */
type Sent = { url: string; init: RequestInit };

/** Runs `generateImage` against a stubbed `fetch` and reports both sides of it. */
async function withStub(
  reply: { status: number; body: unknown },
  term = 'dog'
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
    const image = await generateImage(term, 'https://w.example.dev');
    return { sent, outcome: image };
  } catch (error) {
    return { sent, outcome: error instanceof AiImageError ? error.failure : String(error) };
  } finally {
    globalThis.fetch = real;
  }
}

const ok = await withStub({ status: 200, body: { success: true, result: { image: 'BASE64' } } });

check('obraz wraca do wolajacego', ok.outcome, 'BASE64');
check('idzie pod adres Workera', ok.sent?.url, 'https://w.example.dev');
check('metoda POST', ok.sent?.init.method, 'POST');

const body: unknown = JSON.parse(String(ok.sent?.init.body));
const asked = body as { prompt?: unknown; steps?: unknown };

// The Worker builds nothing: it forwards the prompt as given, so the whole
// prompt has to leave the app.
check('w ciele jedzie gotowy prompt', asked.prompt, buildPrompt('dog'));
check('i liczba krokow', asked.steps, 8);

// No key travels any more — that is the entire point of the Worker. A header
// creeping back in here would mean a token had crept back into the bundle.
const headers = (ok.sent?.init.headers ?? {}) as Record<string, string>;

check('bez naglowka Authorization', 'Authorization' in headers, false);

// A locked Worker answers 403, and the app has to name that rather than blame
// the network.
check(
  'odmowa Workera to nie blad sieci',
  (await withStub({ status: 403, body: { success: false, errors: [{ message: 'Bad app secret.' }] } }))
    .outcome,
  'unauthorized'
);

check(
  'wyczerpany limit ma wlasna nazwe',
  (await withStub({ status: 429, body: { success: false, errors: [{ message: 'quota' }] } })).outcome,
  'rate-limited'
);
