import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { LANGUAGES } from '@/lib/languages';
import { fold } from '@/lib/search';

export type LanguageSheetProps = {
  visible: boolean;
  /** Heading of the sheet, e.g. "Język odpowiedzi". */
  title: string;
  /** The codes picked right now. */
  picked: string[];
  /**
   * Whether this is a choice of exactly one, which the answer side is: a card
   * is in a language, singular, and that one answers both "which voice reads
   * it?" and "which word must the sound-alike sound like?".
   *
   * A single pick replaces and closes, because there is nothing left to decide
   * once it is made — asking for "Gotowe" afterwards would be asking the user
   * to confirm the only thing they did.
   */
  single?: boolean;
  onClose: () => void;
  onChange: (picked: string[]) => void;
};

/**
 * Picking languages from the closed list in `src/lib/languages.ts`.
 *
 * Deliberately **not** `NameSheet`, which tags use and which languages used to.
 * That sheet's whole interaction is "type a name that does not exist yet"; this
 * one's is "find one that does". Sharing them would mean a component with a
 * text box that sometimes creates and sometimes filters, which is two
 * behaviours wearing one coat — and tags would carry the risk of every change
 * made for languages, having only just been through one such merge.
 *
 * The box filters rather than creates, and it folds Polish letters the way the
 * card search does, so `wloski` finds „włoski". English names are searched too:
 * anyone who knows the language by its English name should not have to guess
 * the Polish one.
 */
export function LanguageSheet({
  visible,
  title,
  picked,
  single = false,
  onClose,
  onChange,
}: LanguageSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [typed, setTyped] = useState('');

  const matches = useMemo(() => {
    const needle = fold(typed);

    if (!needle) return LANGUAGES;

    return LANGUAGES.filter(
      (language) =>
        fold(language.name).includes(needle) || fold(language.english).includes(needle)
    );
  }, [typed]);

  const close = () => {
    setTyped('');
    onClose();
  };

  const toggle = (code: string) => {
    if (single) {
      onChange([code]);
      close();
      return;
    }

    // Appending rather than inserting is what makes the picked list a ranking:
    // the order they are tapped in is the order they are used in.
    onChange(picked.includes(code) ? picked.filter((own) => own !== code) : [...picked, code]);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        {/* Swallows taps so they do not reach the backdrop behind the sheet. */}
        <Pressable
          onPress={() => {}}
          style={[
            styles.sheet,
            {
              backgroundColor: theme.backgroundElement,
              paddingBottom: insets.bottom + Spacing.three,
            },
          ]}>
          <View style={[styles.grabber, { backgroundColor: theme.border }]} />

          <ThemedText style={styles.title}>{title}</ThemedText>

          <TextField
            label="Szukaj"
            value={typed}
            onChangeText={setTyped}
            placeholder="np. portugalski"
            autoCapitalize="none"
          />

          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {matches.map((language) => {
              const isPicked = picked.includes(language.code);

              return (
                <Pressable
                  key={language.code}
                  onPress={() => toggle(language.code)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isPicked }}
                  accessibilityLabel={language.name}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      backgroundColor: pressed
                        ? theme.backgroundSelected
                        : isPicked
                          ? theme.backgroundHighlight
                          : 'transparent',
                    },
                  ]}>
                  <ThemedText style={styles.name}>{language.name}</ThemedText>
                  {isPicked ? (
                    <ThemedText style={{ color: theme.accent }}>✓</ThemedText>
                  ) : null}
                </Pressable>
              );
            })}

            {/* A filter that matches nothing is a question worth answering:
                the list is closed, so what is missing is missing on purpose. */}
            {matches.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
                Nie ma takiego języka na liście.
              </ThemedText>
            ) : null}
          </ScrollView>

          <Button title="Gotowe" onPress={close} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    gap: Spacing.three,
    borderTopLeftRadius: Radius.large,
    borderTopRightRadius: Radius.large,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
  },
  /** Tall enough to be a list, short enough to leave the keyboard room. */
  list: {
    maxHeight: 320,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.medium,
  },
  name: {
    flex: 1,
  },
  empty: {
    paddingVertical: Spacing.two,
  },
});
