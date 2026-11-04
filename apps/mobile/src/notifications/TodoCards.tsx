import { View, type StyleProp, type ViewStyle } from 'react-native';
import type { TodoKind } from '@care-platform/shared';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Text } from '@/ui/Text';
import { useBellUser, useNotificationsSummary } from './api';
import { TodoList } from './Lists';

/**
 * To do as big cards on Home (client) and Today (caregiver). Nothing at all
 * when there is nothing to do. `skip` leaves out kinds the screen already
 * shows its own way (Today has its own missing-documents card).
 */
export function TodoCards({ skip = [], style }: { skip?: TodoKind[]; style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation();
  const colors = useColors();
  const user = useBellUser();
  const { data } = useNotificationsSummary();
  const items = (data?.todos ?? []).filter((i) => !skip.includes(i.kind));
  if (!user || !items.length) return null;
  return (
    <View style={[{ gap: 12 }, style]}>
      <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: '800', color: colors.deep }}>
        {t('notifications.todo')}
      </Text>
      <TodoList items={items} />
    </View>
  );
}
