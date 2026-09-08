import type { SheetAction } from '@/components/action-sheet';
import { languageLabel, type DeckLanguages } from '@/lib/languages';
import { soleCandidate, speechCandidates, type SpeechScope } from '@/lib/speech';

/**
 * The entries behind the gear that give a text a voice, or take it away.
 *
 * Shared by both editors on purpose. The card editor sets what one card says
 * out loud; the deck editor sets what a new card *starts out* saying — and if
 * those two ever disagreed about which languages are on offer, the deck would
 * be handing new cards a setting its own card editor refuses to make.
 *
 * The whole shape of the menu is decided by **how many languages the deck
 * declares for this particular text**. One, and switching it on is a single
 * tap: the answer in a deck that learns Portuguese is Portuguese, and asking
 * would be asking somebody to confirm the only option. Several — a question in
 * a deck whose learner reads two languages, or an extra field, which could be
 * either side — and the same tap opens the list instead. None, and the entry
 * stays on the list greyed out with the reason, rather than vanishing and
 * teaching the user that cards cannot be read aloud at all.
 *
 * The list reuses the sheet that is already open (`keepOpen`) rather than
 * opening a second Modal: swapping one for another in the same frame drops the
 * animation on Android.
 */
export type SpeechMenu = {
  /** Which of the card's texts this is — see `speechCandidates`. */
  scope: SpeechScope;
  /** What the deck declares. In the deck editor this is the **form's** state,
   *  not the stored deck: languages and voices are set in the same sitting. */
  languages: DeckLanguages;
  current: string | null;
  set: (code: string | null) => void;
  /** Swaps what the open sheet is showing. */
  show: (sheet: { title: string; actions: SheetAction[] }) => void;
};

export function speechMenu({ scope, languages, current, set, show }: SpeechMenu): SheetAction[] {
  const candidates = speechCandidates(scope, languages);
  const only = soleCandidate(candidates);

  const openList = () =>
    show({
      title: 'Język czytania',
      actions: candidates.map((code) => ({
        label: languageLabel(code),
        onPress: () => set(code),
      })),
    });

  if (!current) {
    return [
      {
        label: 'Czytaj na głos',
        disabled: candidates.length === 0,
        hint:
          candidates.length === 0 ? 'Talia nie mówi, w jakich językach są jej karty.' : undefined,
        keepOpen: !only,
        onPress: () => (only ? set(only) : openList()),
      },
    ];
  }

  return [
    // Offered whenever there is anything else to move to — which includes the
    // deck having since been changed to declare one language that is not the
    // one this field speaks. Without that, the only way back would be turning
    // the voice off and on again.
    ...(candidates.some((code) => code !== current)
      ? [{ label: 'Czytaj w innym języku', keepOpen: true, onPress: openList }]
      : []),
    { label: 'Nie czytaj na głos', onPress: () => set(null) },
  ];
}

/**
 * Which of a deck's declared languages a field is allowed to keep.
 *
 * A **default** that names a language the deck no longer declares is
 * incoherent: the gear only ever offers declared ones, so such a value can only
 * be left over from before the languages were changed — and it would go on
 * handing every new card a voice the deck does not claim. Dropping beats
 * re-pointing at whatever is left, because "you removed English, have Polish
 * instead" is a guess, and a guess about pronunciation is silent when it is
 * wrong.
 *
 * Cards are **not** cleaned up this way: what a card already says out loud is a
 * fact about that card, not a rule waiting to be applied.
 */
export function keptSpeech(
  scope: SpeechScope,
  languages: DeckLanguages,
  code: string | null
): string | null {
  return code && speechCandidates(scope, languages).includes(code) ? code : null;
}
