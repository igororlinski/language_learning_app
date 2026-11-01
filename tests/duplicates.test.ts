/** The "this card already exists" check in the card editor. */
import { findDuplicate, questionKey } from '@/lib/duplicates';

import { check, group } from './harness';

const deck = [
  { id: 1, front: 'Kot', back: 'cat' },
  { id: 2, front: 'łamać', back: 'to break' },
  { id: 3, front: 'dobry  wieczór', back: 'good evening' },
];

group('Duplikaty pytan');

check('wielkosc liter i spacje na brzegach sie nie licza', findDuplicate(' kot ', deck)?.id, 1);
check('polskie litery tez nie', findDuplicate('LAMAC', deck)?.id, 2);
check('kilka spacji to jedna', findDuplicate('dobry wieczór', deck)?.id, 3);
check('inne pytanie to nie duplikat', findDuplicate('pies', deck), null);
check('karta nie jest duplikatem samej siebie', findDuplicate('Kot', deck, 1), null);
check('puste pytanie niczego nie znajduje', findDuplicate('   ', deck), null);
check('klucz pytania', questionKey('  Łamać  Się '), 'lamac sie');
