import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isUsableTag, tagName, tagSlug } from '@/lib/tags';

export type TagSheetProps = {
  visible: boolean;
  /** The tags on the card right now, by name. */
  picked: string[];
  /** Every tag that already exists, so one can be reused instead of retyped. */
  known: string[];
  onClose: () => void;
  onChange: (picked: string[]) => void;
};

/**
 * Picking a card's tags: type a new one, or tap any that already exists.
 *
 * The sheet works in names rather than ids because a tag typed here has no row
 * until the card is saved — see `setCardTagNames`. Nothing typed here creates
 * anything on its own, so a sheet opened and closed leaves no trace.
 */
export function TagSheet({ visible, picked, known, onClose, onChange }: TagSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [typed, setTyped] = useState('');

  const isPicked = (name: string) => picked.some((own) => tagSlug(own) === tagSlug(name));

  const toggle = (name: string) =>
    onChange(
      isPicked(name)
        ? picked.filter((own) => tagSlug(own) !== tagSlug(name))
        : [...picked, tagName(name)]
    );

  const add = () => {
    if (!isUsableTag(typed)) return;

    if (!isPicked(typed)) onChange([...picked, tagName(typed)]);
    setTyped('');
  };

  // Everything known, plus what is on the card but not saved anywhere yet.
  const listed = [...known];
  for (const name of picked) {
    if (!listed.some((own) => tagSlug(own) === tagSlug(name))) listed.push(name);
  }

  const fresh = isUsableTag(typed) && !listed.some((own) => tagSlug(own) === tagSlug(typed));

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

          <ThemedText style={styles.title}>Tagi karty</ThemedText>

          <View style={styles.add}>
            <TextField
              label="Nowy tag"
              value={typed}
              onChangeText={setTyped}
              placeholder="np. czasownik"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={add}
            />
            {fresh ? <Button title={`Dodaj „${tagName(typed)}”`} onPress={add} /> : null}
          </View>

          {listed.length > 0 ? (
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
              {listed.map((name) => {
                const selected = isPicked(name);

                return (
                  <Pressable
                    key={tagSlug(name)}
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
  /** Capped so a long tag list cannot push the input off the screen. */
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
