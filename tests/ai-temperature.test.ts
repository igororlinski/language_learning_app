/**
 * The temperature the user may set on "Ustawienia AI": what counts as one,
 * how a Polish screen writes it, and that "Domyślna" leaves the measured
 * default alone.
 */
import {
  formatTemperature,
  LOCAL_MNEMONIC_SHAPE,
  MNEMONIC_SHAPE,
  parseTemperature,
  TEMPERATURE_CHOICES,
  withTemperature,
} from '@/lib/ai-prompts';

import { check, group } from './harness';

group('Temperatura uzytkownika');

check('od zera do 1,5 co 0,1', TEMPERATURE_CHOICES.length, 16);
check('zaczyna od zera', TEMPERATURE_CHOICES[0], 0);
check('konczy na 1,5', TEMPERATURE_CHOICES[TEMPERATURE_CHOICES.length - 1], 1.5);
// Each choice has to survive the trip through the database as text.
check(
  'kazda pozycja wraca z zapisu taka sama',
  TEMPERATURE_CHOICES.every((t) => parseTemperature(String(t)) === t),
  true
);

check('zapisana liczba', parseTemperature('0.7'), 0.7);
check('zero to temperatura', parseTemperature('0'), 0);
check('brak wiersza to domyslna', parseTemperature(undefined), null);
check('pusty tekst tez', parseTemperature(' '), null);
check('smieci tez', parseTemperature('ciepło'), null);
check('ujemna odpada', parseTemperature('-0.1'), null);
check('powyzej 1,5 odpada', parseTemperature('1.6'), null);

check('przecinek, jedna cyfra', formatTemperature(0.7), '0,7');
check('dwie, gdy trzeba', formatTemperature(0.95), '0,95');
check('jeden to 1,0', formatTemperature(1), '1,0');
check('zero to 0,0', formatTemperature(0), '0,0');

check('domyslna zostawia ksztalt', withTemperature(MNEMONIC_SHAPE, null), MNEMONIC_SHAPE);
check('ustawiona go zastepuje', withTemperature(LOCAL_MNEMONIC_SHAPE, 1.2).temperature, 1.2);
check('zero nie znaczy „nie ustawiono”', withTemperature(MNEMONIC_SHAPE, 0).temperature, 0);
check('schemat zostaje', withTemperature(MNEMONIC_SHAPE, 0.3).schema, MNEMONIC_SHAPE.schema);
