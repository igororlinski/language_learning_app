import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AvatarColors } from '@/constants/theme';
import { avatarIndex, initialOf } from '@/lib/friends';

export type AvatarProps = {
  /** Picks the colour — the same for a person on every screen and every phone. */
  id: string;
  /** Gives the letter. */
  name: string;
  size: number;
  /** A ring around it in this colour — a podium place's metal. */
  ring?: string;
};

/**
 * Someone's round initial, in a colour picked by their id, so a friend looks
 * the same in "Znajomi" and in "Ranking" and different enough from the next
 * one to tell apart at a glance.
 */
export function Avatar({ id, name, size, ring }: AvatarProps) {
  const border = ring ? Math.max(2, size * 0.06) : 0;

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: border,
        borderColor: ring,
        backgroundColor: AvatarColors[avatarIndex(id, AvatarColors.length)],
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <ThemedText
        style={{ color: '#FFFFFF', fontSize: size * 0.42, lineHeight: size * 0.52, fontWeight: '700' }}>
        {initialOf(name)}
      </ThemedText>
    </View>
  );
}
