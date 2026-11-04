import { ScrollView } from 'react-native';
import { useTranslation } from '@/i18n';
import { Screen } from '@/ui/controls';
import { MyRatings } from '@/reviews/CaregiverReviews';

/** The caregiver's own ratings, from Me (and the praise notification). Never who gave which. */
export default function Ratings() {
  const { t } = useTranslation();
  return (
    <Screen title={t('reviews.caregiver.title')} subtitle={t('reviews.caregiver.subtitle')}>
      <ScrollView contentContainerStyle={{ paddingTop: 20, paddingBottom: 40 }}>
        <MyRatings />
      </ScrollView>
    </Screen>
  );
}
