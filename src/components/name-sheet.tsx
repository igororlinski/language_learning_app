import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type NameSheetProps = {
  visible: boolean;
  /** Heading of the sheet, e.g. "Tagi karty". */
  title: string;
  /** Label over the text box, e.g. "Nowy tag". */
  inputLabel: string;
  placeholder?: string;
  /** The names picked right now. */
  picked: string[];
  /** Every name already in use somewhere, so one can be reused instead of retyped. */
  known: string[];
  /** The spelling to store for what was typed — trimming and length are its business. */
  normalize: (raw: string) => string;
  /** What makes two spellings the same name. Two domains, two foldings, one sheet. */
  identity: (raw: string) => string;
  onClose: () => void;
  onChange: (picked: string[]) => void;
};

/**
 * Picking a set of short names by typing them: type a new one, or tap any that
 * already exists.
 *
 * It works in names rather than ids because in both places that use it nothing
 * exists until the thing being edited is saved — a tag typed here has no row
 * until the card is written, and a language is never a row at all. So a sheet
 * opened, typed into and closed leaves no trace.
 *
 * `normalize` and `identity` are injected rather than picked here on purpose:
 * tags and languages fold the same way today, and a copy of that folding living
 * in this component is exactly how the two would quietly drift apart.
 */
export function NameSheet({
  visible,
  title,
  inputLabel,
  placeholder,
  picked,
  known,
  normalize,
  identity,
  onClose,
  onChange,
}: NameSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [typed, setTyped] = useState('');

  const usable = (name: string) => identity(name).length > 0;
  const isPicked = (name: string) => picked.some((own) => identity(own) === identity(name));

  const toggle = (name: string) =>
    onChange(
      isPicked(name)
        ? picked.filter((own) => identity(own) !== identity(name))
        : [...picked, normalize(name)]
    );

  const add = () => {
    if (!usable(typed)) return;

    if (!isPicked(typed)) onChange([...picked, normalize(typed)]);
    setTyped('');
  };

  // Everything known, plus what is picked but not saved anywhere yet.
  const listed = [...known];
  for (const name of picked) {
    if (!listed.some((own) => identity(own) === identity(name))) listed.push(name);
  }

  const fresh = usable(typed) && !listed.some((own) => identity(own) === identity(typed));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
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

          <View style={styles.add}>
            <TextField
              label={inputLabel}
              value={typed}
              onChangeText={setTyped}
              placeholder={placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={add}
            />
            {fresh ? <Button title={`Dodaj „${normalize(typed)}”`} onPress={add} /> : null}
          </View>

          {listed.length > 0 ? (
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
              {listed.map((name) => {
                const selected = isPicked(name);

                return (
                  <Pressable
                    key={identity(name)}
                    onPress={() => toggle(name)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={name}
                    style={({ pressed }) => [
                      styles.option,
                      {
                        borderColor: theme.border,
                        backgroundColor: pressed ? theme.backgroundSelected : 'transparent',
                      },
                    ]}>
                    <ThemedText
                      type={selected ? 'smallBold' : 'small'}
                      style={selected ? { color: theme.accent } : undefined}>
                      {name}
                    </ThemedText>
                    {selected ? (
                      <ThemedText type="small" style={{ color: theme.accent }}>
                        ✓
                      </ThemedText>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          <Button title="Gotowe" variant="ghost" onPress={onClose} />
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
  add: {
    gap: Spacing.two,
  },
  /** Capped so a long list cannot push the input off the screen. */
  list: {
    maxHeight: 260,
  },
  listContent: {
    paddingBottom: Spacing.one,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
