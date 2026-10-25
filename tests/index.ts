/**
 * Test entry point. Every suite is imported for its side effects, in order,
 * then the shared counter decides the exit code — that is what lets `npm test`
 * fail a build rather than just printing red text.
 */
import './search.test';
import './queue-order.test';
import './card-layout.test';
import './card-sort.test';
import './card-draft.test';
import './field-rows.test';
import './media.test';
import './ai-transport.test';
import './ai-keys.test';
import './ai-usage.test';
import './ai-text.test';
import './ai-image.test';
import './ai-phonetic.test';
import './mnemonic.test';
import './sounds-like.test';
import './ai-temperature.test';
import './stats.test';
import './goals.test';
import './archive.test';
import './deck-package.test';
import './csv-import.test';
import './languages.test';
import './speech.test';
import './tags.test';
import './study-day.test';
import './fsrs-options.test';
import './fsrs-optimizer.test';
import './data-layer.test';

import { failureCount } from './harness';

const failures = failureCount();

console.log(
  failures === 0 ? '\nWszystkie testy przeszly.\n' : `\n${failures} test(ow) nie przeszlo.\n`
);

process.exit(failures === 0 ? 0 : 1);
