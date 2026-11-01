import Constants from 'expo-constants';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { HelpBody } from '@/components/help-body';
import { ThemedText } from '@/components/themed-text';
import { ABOUT_CHAPTERS, HELP_TOPICS, type HelpTopicId } from '@/constants/help';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * "O tej aplikacji": what the app is and how its parts work, as a list of
 * chapters that open in place. The chapters are help topics like any other —
 * the text lives in `constants/help.ts`, this screen only lays them out.
 *
 * Reached from the side menu and from the empty deck list, never pushed on
 * anyone: whoever wants the story asks for it.
 */
export { ErrorScreen as ErrorBoundary } from '@/components/error-screen';

export default function AboutScreen() {
  const theme = useTheme();
  const [open, setOpen] = useState<ReadonlySet<HelpTopicId>>(new Set());

  const toggle = (chapter: HelpTopicId) =>
    setOpen((was) => {
      const next = new Set(was);
      if (!next.delete(chapter)) next.add(chapter);
      return next;
    });

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}>
      {ABOUT_CHAPTERS.map((chapter) => {
        const { title, body } = HELP_TOPICS[chapter];
        const expanded = open.has(chapter);

        return (
          <View
            key={chapter}
            style={[styles.chapter, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <Pressable
              onPress={() => toggle(chapter)}
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              style={({ pressed }) => [styles.header, { opacity: pressed ? 0.6 : 1 }]}>
              <ThemedText style={styles.title}>{title}</ThemedText>
              <ThemedText type="small" style={{ color: theme.accent }}>
                {expanded ? '▲' : '▼'}
              </ThemedText>
            </Pressable>
            {expanded ? <HelpBody body={body} style={styles.body} /> : null}
          </View>
        );
      })}

      {Constants.expoConfig?.version ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.version}>
          Wersja {Constants.expoConfig.version}
        </ThemedText>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.three,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  chapter: {
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    padding: Spacing.three,
  },
  title: {
    flexShrink: 1,
    fontWeight: '600',
  },
  body: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
  },
  version: {
    textAlign: 'center',
    marginTop: Spacing.three,
  },
});
