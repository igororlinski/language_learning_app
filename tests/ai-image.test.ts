/**
 * What a picture request carries: the decoration around the subject, and the
 * step count — which is a spending decision rather than a tuning detail, so it
 * gets an assertion instead of a silent default.
 */
import { buildPrompt, generateImage, generatePicture } from '@/lib/ai-image';

import { withStub } from './ai-worker.test';
import { check, group } from './harness';

group('Prompt do generatora obrazu');

const prompt = buildPrompt('  to   break  ');

check('hasło trafia do promptu', prompt.includes('to break'), true);
check('i jest scisniete ze spacji', prompt.includes('to   break'), false);
// Image models like writing words into pictures, and a misspelt word on a
// vocabulary card teaches the misspelling.
check('prompt zabrania tekstu na obrazie', prompt.includes('No text'), true);
check('mieści się w limicie Cloudflare', buildPrompt('x'.repeat(5000)).length <= 2048, true);

group('O co prosi zadanie o obraz');

const made = await withStub({ status: 200, body: { success: true, result: { image: 'BASE64' } } }, () =>
  generateImage('dog', 'fast', 'https://w.example.dev')
);

check('obraz wraca do wolajacego', made.outcome, 'BASE64');
check('idzie na sciezke obrazu', made.sent?.url, 'https://w.example.dev/image');

const body = JSON.parse(String(made.sent?.init.body)) as {
  prompt?: unknown;
  steps?: unknown;
  quality?: unknown;
  model?: unknown;
};

// The Worker builds nothing for pictures: it forwards the prompt as given, so
// the whole decorated prompt has to leave the app.
check('w ciele jedzie gotowy prompt', body.prompt, buildPrompt('dog'));

// Steps are most of what a quick picture costs — see the comment on STEPS.
check('i liczba krokow', body.steps, 4);

group('Dokładny albo szybki — wybór użytkownika');

check('pole ai-image prosi o szybki obraz', body.quality, 'fast');

// The app names an outcome and never a model: which model draws a careful
// picture is settled in the Worker, where changing it is a deploy rather than a
// new build on somebody's phone.
check('i nie nazywa modelu', 'model' in body, false);

const careful = await withStub(
  { status: 200, body: { success: true, result: { image: 'BASE64' } } },
  () => generatePicture('scena ze skojarzenia', 'accurate', 'https://w.example.dev')
);

const carefulBody = JSON.parse(String(careful.sent?.init.body)) as { quality?: unknown };

check('wybrana jakosc jedzie w zadaniu', carefulBody.quality, 'accurate');

// Nothing in the app may get slower by accident: the careful picture is the
// one the user asked for, never the one a default handed them.
const byDefault = await withStub(
  { status: 200, body: { success: true, result: { image: 'BASE64' } } },
  () => generatePicture('scena', undefined, 'https://w.example.dev')
);

check(
  'bez wyboru zostaje szybki',
  (JSON.parse(String(byDefault.sent?.init.body)) as { quality?: unknown }).quality,
  'fast'
);

group('Czego zadanie o obraz nie sprobuje');

/** The failure a call rejects with, without ever reaching the network. */
async function refusal(call: () => Promise<unknown>) {
  try {
    await call();
    return 'nie odmowil';
  } catch (error) {
    return error instanceof Error ? (error as { failure?: string }).failure ?? error.message : String(error);
  }
}

check(
  'puste haslo nie idzie nigdzie',
  await refusal(() => generateImage('   ', 'fast', 'https://w.example.dev')),
  'empty-prompt'
);
check(
  'pusty prompt sceny tez nie',
  await refusal(() => generatePicture('   ', 'accurate', 'https://w.example.dev')),
  'empty-prompt'
);
