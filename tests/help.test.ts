/**
 * The "?" topics: every one has a title and something to say. That the ids a
 * screen asks for exist is `tsc`'s job — `HelpTopicId` is the registry's keys.
 */
import { HELP_TOPICS, type HelpBlock, type HelpTopic } from '@/constants/help';

import { check, group } from './harness';

const filled = (text: string) => text.trim().length > 0;

const items = (block: Exclude<HelpBlock, string>) => ('steps' in block ? block.steps : block.list);

const blockFilled = (block: HelpBlock) =>
  typeof block === 'string' ? filled(block) : items(block).length > 0 && items(block).every(filled);

group('Pomoc: tematy');

const topics = Object.entries<HelpTopic>(HELP_TOPICS);

check(
  'kazdy temat ma tytul i tresc',
  topics.filter(([, topic]) => !filled(topic.title) || topic.body.length === 0).map(([id]) => id),
  []
);
check(
  'zaden akapit ani punkt nie jest pusty',
  topics.filter(([, topic]) => !topic.body.every(blockFilled)).map(([id]) => id),
  []
);
check(
  'liczby z kodu trafily do tresci',
  JSON.stringify(HELP_TOPICS).match(/undefined|NaN/g),
  null
);
