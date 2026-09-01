/**
 * Test entry point. Every suite is imported for its side effects, in order,
 * then the shared counter decides the exit code — that is what lets `npm test`
 * fail a build rather than just printing red text.
 */
import './search.test';
import './queue-order.test';
import './card-layout.test';
import './card-sort.test';
import './field-rows.test';
import './media.test';
import './data-layer.test';

import { failureCount } from './harness';

const failures = failureCount();

console.log(
  failures === 0 ? '\nWszystkie testy przeszly.\n' : `\n${failures} test(ow) nie przeszlo.\n`
);

process.exit(failures === 0 ? 0 : 1);
