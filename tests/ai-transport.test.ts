/**
 * The one door out of the app: what a request carries, what it accepts back,
 * and what each way of failing is called.
 *
 * Everything here runs against a stubbed `fetch`, because the point is the
 * contract with the providers rather than the providers themselves — the half
 * that breaks silently if a field moves, and the half that must never hand a
 * screen `undefined` to write into a file.
 */
import {
  AiError,
  CLOUD_TEXT,
  errorDetail,
  failureForStatus,
  parseTextSource,
  resultFromResponse,
  runCloudflare,
  send,
} from '@/lib/ai-transport';

import { check, group } from './harness';

export type Sent = { url: string; init: RequestInit };

type StubReply = { status: number; body: unknown };

/**
 * Runs `call` against a stubbed `fetch` and reports both sides of it.
 *
 * `reply` is one answer for every request, or a function choosing one per
 * request — the cloud chain asks several providers in turn. A function that
 * throws is a request that never connected. `sent` is the first request,
 * `calls` all of them.
 */
export async function withStub<T>(
  reply: StubReply | ((url: string, init: RequestInit) => StubReply),
  call: () => Promise<T>
): Promise<{ sent: Sent | null; calls: Sent[]; outcome: string }> {
  const real = globalThis.fetch;
  const calls: Sent[] = [];

  globalThis.fetch = ((url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });

    try {
      const answer = typeof reply === 'function' ? reply(String(url), init) : reply;

      return Promise.resolve({
        ok: answer.status >= 200 && answer.status < 300,
        status: answer.status,
        json: () => Promise.resolve(answer.body),
      } as Response);
    } catch (error) {
      return Promise.reject(error);
    }
  }) as typeof fetch;

  try {
    // Awaited into a variable first, on purpose: an object literal evaluates its
    // properties left to right, so `{ calls, outcome: await call() }` would read
    // the calls before the call had run.
    const outcome = String(await call());

    return { sent: calls[0] ?? null, calls, outcome };
  } catch (error) {
    return {
      sent: calls[0] ?? null,
      calls,
      outcome: error instanceof AiError ? error.failure : String(error),
    };
  } finally {
    globalThis.fetch = real;
  }
}

/** The JSON a stubbed request sent. */
export const bodyOf = (sent: Sent | null | undefined) =>
  JSON.parse(String(sent?.init.body)) as Record<string, unknown>;

/** The headers a stubbed request sent. */
export const headersOf = (sent: Sent | null | undefined) =>
  (sent?.init.headers ?? {}) as Record<string, string>;

group('Odczyt koperty Cloudflare');

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
  'komunikat niesie slowa dostawcy',
  new AiError('provider', 'blocked').message.includes('blocked'),
  true
);

group('Slowa dostawcy, w trzech ksztaltach');

check('Cloudflare', errorDetail({ errors: [{ message: 'bad token' }] }), 'bad token');
check('Google', errorDetail({ error: { message: 'API key not valid', status: 'INVALID' } }), 'API key not valid');
check('LM Studio jako napis', errorDetail({ error: 'model not found' }), 'model not found');
check('nic do powiedzenia', errorDetail({}), undefined);

group('Co znacza kody HTTP');

check('401 to odrzucony klucz', failureForStatus(401), 'unauthorized');
check('403 tez', failureForStatus(403), 'unauthorized');
check('429 to wyczerpany limit', failureForStatus(429), 'rate-limited');
// Cloudflare's neuron allowance does not always come back as a 429.
check('limit poznany po slowach', failureForStatus(400, 'daily neuron allocation exceeded'), 'rate-limited');
check('500 to problem po stronie dostawcy', failureForStatus(500), 'provider');

group('Jak wychodzi zadanie');

const json = await withStub({ status: 200, body: { ok: 1 } }, () =>
  send('https://p.example.dev/x', { headers: { 'x-key': 'k' }, body: { a: 1 } }).then((reply) =>
    JSON.stringify(reply.body)
  )
);

check('metoda POST', json.sent?.init.method, 'POST');
check('JSON z naglowkiem typu', headersOf(json.sent)['Content-Type'], 'application/json');
check('i naglowkami wolajacego', headersOf(json.sent)['x-key'], 'k');
check('cialo jako JSON', bodyOf(json.sent), { a: 1 });
check('odpowiedz wraca w calosci', json.outcome, '{"ok":1}');

// The FLUX 2 models take a multipart form, and `fetch` must write its own
// boundary into the content type — a hand-set header breaks it.
const form = new FormData();

form.append('prompt', 'x');

const multipart = await withStub({ status: 200, body: {} }, () =>
  send('https://p.example.dev/x', { body: form })
);

check('formularz idzie bez recznego typu', 'Content-Type' in headersOf(multipart.sent), false);
check('jako ten sam formularz', multipart.sent?.init.body === form, true);

const offline = await withStub(
  () => {
    throw new Error('Network request failed');
  },
  () => send('https://p.example.dev/x')
);

check('brak polaczenia ma wlasna nazwe', offline.outcome, 'network');

group('Workers AI na koncie uzytkownika');

const ran = await withStub(
  { status: 200, body: { success: true, result: { image: 'B64' } } },
  () => runCloudflare('ACC', 'TOKEN', '@cf/black-forest-labs/flux-1-schnell', { prompt: 'x' })
    .then((result) => result.image)
);

check(
  'adres z ID konta i modelem',
  ran.sent?.url,
  'https://api.cloudflare.com/client/v4/accounts/ACC/ai/run/@cf/black-forest-labs/flux-1-schnell'
);
check('token uzytkownika w naglowku', headersOf(ran.sent).Authorization, 'Bearer TOKEN');
check('wynik wyjety z koperty', ran.outcome, 'B64');

const refusedToken = await withStub(
  { status: 403, body: { success: false, errors: [{ message: 'Authentication error' }] } },
  () => runCloudflare('ACC', 'BAD', 'model', {})
);

check('zly token to odrzucony klucz', refusedToken.outcome, 'unauthorized');

// A wrong account id is a 404 "Could not route", checked live.
const unknownAccount = await withStub(
  { status: 404, body: { success: false, errors: [{ code: 7003, message: 'Could not route' }] } },
  () => runCloudflare('0000', 'T', 'model', {})
);

check('nieznane ID konta to tez zly klucz', unknownAccount.outcome, 'unauthorized');

group('Kto pisze skojarzenia: chmura albo LM Studio');

check('nic zapisanego to chmura', parseTextSource(undefined, undefined), CLOUD_TEXT);
check('nieznana nazwa tez', parseTextSource('ollama', 'x'), CLOUD_TEXT);
// A model only means something for LM Studio.
check('chmura gubi model', parseTextSource('cloud', 'qwen'), CLOUD_TEXT);
check('LM Studio z modelem', parseTextSource('lmstudio', ' qwen3-14b '), {
  provider: 'lmstudio',
  model: 'qwen3-14b',
});
check('LM Studio z pustym modelem to pierwszy z brzegu', parseTextSource('lmstudio', '  ').model, null);

group('Dostawca, ktory nie odpowiada');

/** A `fetch` that never answers on its own and fails only when aborted, like the real one. */
async function hanging(timeoutMs: number) {
  const real = globalThis.fetch;

  globalThis.fetch = ((_url: string, init: RequestInit) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
    })) as typeof fetch;

  try {
    await send('https://p.example.dev/x', { body: {}, timeoutMs });
    return 'odpowiedzial';
  } catch (error) {
    return error instanceof AiError ? error.failure : String(error);
  } finally {
    globalThis.fetch = real;
  }
}

// Without a limit the spinner turned for good; now the wait ends with a sentence.
check('zawieszone zadanie konczy sie po limicie czasu', await hanging(20), 'timeout');
