import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  NestedReorderableList,
  reorderItems,
  useIsActive,
  useReorderableDrag,
  type ReorderableListReorderEvent,
} from 'react-native-reorderable-list';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Row, RowInfo } from '@/lib/field-rows';

export type FieldLayoutListProps = {
  rows: Row[];
  info: Record<string, RowInfo>;
  onChange: (rows: Row[]) => void;
  /** The contents of one row — a text field in the card editor, a note in the deck's. */
  renderRow: (row: Row, info: RowInfo) => ReactNode;
};

/**
 * The list both editors arrange a layout in: mandatory fields, extra fields and
 * one boundary row telling the two faces apart. Everything but the boundary can
 * be dragged anywhere, so a mandatory field may change sides and a face may end
 * up empty.
 */
export function FieldLayoutList({ rows, info, onChange, renderRow }: FieldLayoutListProps) {
  const reorder = (event: ReorderableListReorderEvent) =>
    onChange(reorderItems(rows, event.from, event.to));

  return (
    <NestedReorderableList
      data={rows}
      keyExtractor={(row) => row.key}
      onReorder={reorder}
      scrollEnabled={false}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View style={styles.header}>
          <SideBoundary label="Przód karty" />
        </View>
      }
      renderItem={({ item }) => {
        if (item.kind === 'boundary') return <SideBoundary label="Tył karty" />;

        const rowInfo = info[item.key];

        return (
          <RowBox label={rowInfo.label} base={item.kind === 'base'}>
            {renderRow(item, rowInfo)}
          </RowBox>
        );
      }}
    />
  );
}

/** The line that splits the list into the card's two faces. */
function SideBoundary({ label }: { label: string }) {
  const theme = useTheme();

  return (
    <View style={styles.boundary}>
      <View style={[styles.boundaryLine, { borderColor: theme.border }]} />
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.boundaryLabel}>
        {label.toUpperCase()}
      </ThemedText>
      <View style={[styles.boundaryLine, { borderColor: theme.border }]} />
    </View>
  );
}

/**
 * The frame every row shares. The two mandatory fields get a warm tint and
 * nothing else — they behave like every other row, so the only thing worth
 * signalling is that these are the two that cannot be removed. The accent
 * outline is kept for the row being dragged, where it means something.
 */
function RowBox({
  label,
  base,
  children,
}: {
  label: string;
  base: boolean;
  children: ReactNode;
}) {
  const theme = useTheme();
  const drag = useReorderableDrag();
  const isActive = useIsActive();

  return (
    <View
      style={[
        styles.row,
        {
          borderColor: isActive ? theme.accent : theme.border,
          backgroundColor: base ? theme.backgroundHighlight : theme.backgroundElement,
        },
      ]}>
      <Pressable
        onLongPress={drag}
        delayLongPress={200}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Przesuń: ${label}`}
        accessibilityHint="Przytrzymaj i przeciągnij, żeby zmienić kolejność lub stronę karty"
        style={styles.handle}>
        {[0, 1, 2].map((bar) => (
          <View key={bar} style={[styles.handleBar, { backgroundColor: theme.textSecondary }]} />
        ))}
      </Pressable>

      <View style={styles.rowMain}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: Spacing.two,
  },
  header: {
    gap: Spacing.two,
    paddingBottom: Spacing.two,
  },
  boundary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  boundaryLine: {
    flex: 1,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  boundaryLabel: {
    letterSpacing: 1,
    fontSize: 11,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    padding: Spacing.two,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
  handle: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.one,
    gap: 3,
    justifyContent: 'center',
  },
  handleBar: {
    width: 16,
    height: 2,
    borderRadius: 1,
  },
  rowMain: {
    flex: 1,
    gap: Spacing.one,
  },
});
