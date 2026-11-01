import { DEFAULT_NEW_PER_DAY, DEFAULT_REVIEWS_PER_DAY } from '@/db/schema';
import { DEFAULT_DAILY_GOAL } from '@/lib/goals';
import { MIN_SAMPLES } from '@/lib/fsrs-optimizer';
import {
  GROWTH_WEEKS,
  MATURE_DAYS,
  MAX_ANSWER_MS,
  MIN_ANSWERS,
  RETENTION_SLACK,
  RETENTION_WINDOW_DAYS,
  STUDY_TIME_DAYS,
} from '@/lib/stats';
import {
  DEFAULT_LEARNING_STEPS,
  DEFAULT_RELEARNING_STEPS,
  DEFAULT_RETENTION,
  formatRetention,
} from '@/lib/fsrs-options';

/**
 * Everything the "?" buttons explain, in one place.
 *
 * The screens stay free of explanations — labels and actions only, the rule
 * since 2026-09-01 — and whoever wants the longer story asks for it with a tap.
 * Keeping the text here rather than next to each button means a screen says
 * *which* topic and nothing more, the wording can be read and fixed in one
 * file, and a topic shared by two screens cannot drift into two versions.
 *
 * **Adding one:** a new key below, then `<HelpButton topic="…" />` — or
 * `help="…"` on a `TextField`, `OptionPicker` or `Dropdown`, or `<WithHelp>`
 * around any heading. The key is a type, so a typo or a deleted topic fails
 * `tsc` instead of opening an empty sheet.
 *
 * Numbers that the code decides (defaults, thresholds) are read from the code,
 * so the help cannot go on promising a default that has since changed.
 */

/**
 * One piece of a topic's body:
 * - a string is a paragraph,
 * - `list` is bullet points — things side by side,
 * - `steps` is numbered — things done in order.
 */
export type HelpBlock = string | { list: readonly string[] } | { steps: readonly string[] };

export type HelpTopic = {
  /** The sheet's heading; also read out by the screen reader on the button. */
  title: string;
  body: readonly HelpBlock[];
};

export const HELP_TOPICS = {
  'deck.limits': {
    title: 'Dzienne limity',
    body: [
      'Ile kart ta talia może dać jednego dnia. Dzień nauki zaczyna się o 4:00, nie o północy.',
      {
        list: [
          `Nowe karty dziennie — ile kart widzianych pierwszy raz wejdzie do nauki. Domyślnie ${DEFAULT_NEW_PER_DAY}.`,
          `Maksimum powtórek dziennie — ile kart już znanych wróci do powtórki. Domyślnie ${DEFAULT_REVIEWS_PER_DAY}. Reszta poczeka do jutra.`,
        ],
      },
      'Karta w trakcie kroków nauki wraca zawsze, nawet gdy limit na dziś jest już wyczerpany.',
    ],
  },

  'deck.algorithm': {
    title: 'Algorytm powtórek',
    body: [
      'Terminy powtórek liczy FSRS: po każdej odpowiedzi szacuje, jak długo jeszcze będziesz pamiętać kartę, i wyznacza powtórkę na chwilę, zanim zaczniesz ją zapominać.',
      {
        list: [
          `Nowa karta wraca po — kroki nauki w pierwszym dniu, np. „${DEFAULT_LEARNING_STEPS}”: po minucie, potem po dziesięciu. Jednostki m, h, d, rosnąco.`,
          `Zapomniana karta wraca po — to samo dla karty, którą oceniłeś „Znowu” na powtórce. Domyślnie „${DEFAULT_RELEARNING_STEPS}”.`,
          `Jak często wracają karty — im częściej, tym lepiej pamiętasz, ale masz więcej powtórek. Domyślnie ${formatRetention(DEFAULT_RETENTION)}, czyli 94% szans, że pamiętasz kartę w dniu powtórki.`,
          'Karta nie zniknie na dłużej niż — najdłuższy możliwy odstęp między powtórkami.',
        ],
      },
    ],
  },

  'deck.weights': {
    title: 'Wagi FSRS',
    body: [
      'Wagi mówią algorytmowi, jak długo zwykle pamiętasz kartę po pierwszym dniu nauki — osobno dla każdej oceny.',
      'Na początku są domyślne, wspólne dla wszystkich. „Optymalizuj” dopasowuje je do tego, jak naprawdę szło ci w tej talii.',
      {
        steps: [
          'Ucz się talii przez kilka tygodni.',
          'Dotknij „Optymalizuj”.',
          `Ocena, która zakończyła pierwszy dzień co najmniej ${MIN_SAMPLES} kart, dostaje własną wagę; reszta zostaje domyślna.`,
        ],
      },
      '„Wróć do domyślnych” cofa dopasowanie.',
    ],
  },

  'stats.goal': {
    title: 'Cel dzienny',
    body: [
      `Liczba odpowiedzi w ciągu dnia — każda ocena karty liczy się raz, także powtórzenie tej samej karty. Domyślnie ${DEFAULT_DAILY_GOAL}.`,
      'Dzień zaczyna się o 4:00. Każdy dzień zapamiętuje swój cel, więc zmiana celu nie przepisuje przeszłości.',
      'Lżejsze dni — wybrane dni tygodnia z mniejszym celem. Bez wpisanego celu lżejszy dzień wymaga połowy zwykłego.',
    ],
  },

  'stats.streak': {
    title: 'Seria',
    body: [
      'Liczba dni z rzędu, w których cel był spełniony.',
      'Dzień bez spełnionego celu przerywa serię. Dzisiejszy dzień przerywa ją dopiero, gdy minie — do 4:00 rano możesz go jeszcze uratować.',
    ],
  },

  'stats.today': {
    title: 'Dzisiaj',
    body: [
      'Ile razy dziś oceniłeś kartę w wybranej talii — przy „Wszystkie talie” we wszystkich razem. Dzień zaczyna się o 4:00.',
      {
        list: [
          'Nowe — pierwsze odpowiedzi na karty, których jeszcze nie widziałeś.',
          'Nauka — karty w krokach nauki: świeżo poznane albo zapomniane i uczone od nowa.',
          'Powtórki — karty już nauczone, które wróciły po kilku dniach.',
          'Poprawnie — jaka część dzisiejszych odpowiedzi to nie „Znowu”.',
        ],
      },
    ],
  },

  'stats.time': {
    title: 'Czas nauki',
    body: [
      `Ile czasu spędziłeś nad kartami przez ostatnie ${STUDY_TIME_DAYS} dni — od pokazania karty do jej oceny. Jedna odpowiedź liczy się najwyżej ${MAX_ANSWER_MS / 1000} sekund, żeby telefon odłożony na stół z otwartą kartą nie zawyżał wyniku.`,
      'Słupki to kolejne dni, dzisiejszy po prawej. Odpowiedzi sprzed 23 października 2026 nie były mierzone i się nie liczą.',
    ],
  },

  'stats.forecast': {
    title: 'Do powtórki',
    body: [
      'Ile kart wróci do powtórki każdego dnia — na tydzień albo miesiąc naprzód.',
      {
        list: [
          'Dziś — wszystko, co już czeka, razem z zaległymi i kartami w krokach nauki.',
          'Nowe karty nie są liczone: wchodzą według dziennego limitu talii, nie według daty.',
          'Limit powtórek też nie jest odejmowany, żeby było widać prawdziwą górę kart — choćby przed wyjazdem.',
        ],
      },
    ],
  },

  'stats.retention': {
    title: 'Zapamiętane',
    body: [
      `Jaka część powtórek z ostatnich ${RETENTION_WINDOW_DAYS} dni skończyła się czymś innym niż „Znowu” — czyli jak często pamiętasz kartę, gdy wraca. Kroki nauki się nie liczą: odpowiedź po dziesięciu minutach nic nie mówi o pamięci.`,
      'Kreska na pasku to cel talii — „Jak często wracają karty” w jej ustawieniach. Przy wszystkich taliach to średnia, ważona tym, z której talii były powtórki.',
      {
        list: [
          'Na celu — algorytm trafia z odstępami.',
          `Trochę poniżej celu — do ${Math.round(RETENTION_SLACK * 100)} punktów procentowych pod kreską; zwykle wahanie.`,
          'Poniżej celu — odstępy są za długie dla twojej pamięci. Pomaga „Optymalizuj” w ustawieniach talii, gdy uzbiera się historia.',
        ],
      },
      `Procent pojawia się od ${MIN_ANSWERS} powtórek — z mniejszej liczby byłby przypadkiem.`,
    ],
  },

  'stats.grades': {
    title: 'Oceny',
    body: [
      `Jak rozkładały się twoje oceny przez ostatnie ${RETENTION_WINDOW_DAYS} dni, osobno dla powtórek i dla nauki.`,
      {
        list: [
          'W powtórkach większość powinna być „Dobre”. „Trudne” to wciąż zapamiętana karta, tylko z wysiłkiem.',
          '„Łatwe” warto zostawić na karty naprawdę oczywiste — każde mocno wydłuża następny odstęp.',
          'W nauce dużo „Znowu” jest normalne: tak działają kroki nauki.',
        ],
      },
    ],
  },

  'stats.mnemonics': {
    title: 'Skojarzenia a pamięć',
    body: [
      'Porównanie, jak często pamiętasz w powtórkach karty ze skojarzeniem, a jak te bez — z całej historii. Duża liczba to różnica w punktach procentowych.',
      'To wskazówka, nie dowód: skojarzenia zwykle dostają słowa, które szły najgorzej, a karta liczy się jako „ze skojarzeniem” także za odpowiedzi sprzed jego dodania.',
      `Wynik pojawia się, gdy obie strony mają po ${MIN_ANSWERS} powtórek.`,
    ],
  },

  'stats.collection': {
    title: 'Karty',
    body: [
      'Gdzie są twoje karty na drodze od nowej do zapamiętanej na długo.',
      {
        list: [
          'Nowe — jeszcze nie widziane.',
          'W nauce — w krokach nauki albo uczone od nowa po zapomnieniu.',
          `Młode — w powtórkach, z odstępem krótszym niż ${MATURE_DAYS} dni.`,
          `Dojrzałe — w powtórkach, z odstępem ${MATURE_DAYS} dni lub dłuższym: tych zwykle się już nie zapomina.`,
        ],
      },
      `Słupki pokazują, jak było na koniec każdego z ostatnich ${GROWTH_WEEKS} tygodni — odtworzone z historii odpowiedzi. Karta bez żadnej odpowiedzi, na przykład z importu CSV, pojawia się w nich dopiero po pierwszej.`,
    ],
  },

  // „O tej aplikacji” — rozdziały w kolejności z `ABOUT_CHAPTERS`.
  // TODO: prawdziwa treść zamiast lorem ipsum.
  'about.intro': {
    title: 'Czym jest ta aplikacja',
    body: [
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
      'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
    ],
  },

  'about.decks': {
    title: 'Talie i karty',
    body: [
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
      { list: ['Lorem ipsum dolor sit amet.', 'Consectetur adipiscing elit.', 'Sed do eiusmod tempor.'] },
    ],
  },

  'about.review': {
    title: 'Nauka i oceny',
    body: [
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
      { steps: ['Lorem ipsum dolor sit amet.', 'Consectetur adipiscing elit.', 'Sed do eiusmod tempor.'] },
    ],
  },

  'about.mnemonics': {
    title: 'Skojarzenia fonetyczne',
    body: [
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
      'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
    ],
  },

  'about.ai': {
    title: 'AI i klucze',
    body: [
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
      { list: ['Lorem ipsum dolor sit amet.', 'Consectetur adipiscing elit.', 'Sed do eiusmod tempor.'] },
    ],
  },

  'about.goals': {
    title: 'Cel, seria i odznaki',
    body: [
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
      'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
    ],
  },

  'about.friends': {
    title: 'Znajomi i ranking',
    body: [
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
      'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
    ],
  },

  'about.backup': {
    title: 'Kopia zapasowa i przenoszenie talii',
    body: [
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
      { steps: ['Lorem ipsum dolor sit amet.', 'Consectetur adipiscing elit.', 'Sed do eiusmod tempor.'] },
    ],
  },
} as const satisfies Record<string, HelpTopic>;

export type HelpTopicId = keyof typeof HELP_TOPICS;

/**
 * The chapters of "O tej aplikacji", in reading order. Each is an ordinary
 * topic, so any of them can also sit behind a "?" on the screen it is about.
 */
export const ABOUT_CHAPTERS: readonly HelpTopicId[] = [
  'about.intro',
  'about.decks',
  'about.review',
  'about.mnemonics',
  'about.ai',
  'about.goals',
  'about.friends',
  'about.backup',
];
