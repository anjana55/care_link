import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ClientBooking, MyIssueReport } from '@care-platform/shared';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button } from '@/ui/controls';
import { Text } from '@/ui/Text';
import { useReportBookingIssue } from './billing-api';
import { IssueForm, IssueReportList } from './IssueForm';

/**
 * "Something's not right?" on one booking, as on the website: it never
 * changes the record - our team checks it, puts it right or explains, and
 * says so. The reports already sent about this booking are listed with our answer.
 */
export function BookingIssues({ booking, reports }: { booking: ClientBooking; reports: MyIssueReport[] }) {
  const { t } = useTranslation();
  const colors = useColors();
  const report = useReportBookingIssue(booking.id);
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);

  return (
    <View style={[styles.box, { borderColor: colors.border }]}>
      <IssueReportList reports={reports} />
      {sent && !open ? (
        <Text accessibilityLiveRegion="polite" style={{ fontSize: 14, color: colors.brand }}>
          {t('issues.sent')}
        </Text>
      ) : null}
      {open ? (
        <IssueForm
          role="CLIENT"
          shifts={booking.shifts}
          pending={report.isPending}
          error={report.error}
          onCancel={() => setOpen(false)}
          onSubmit={(body) =>
            report.mutate(body, {
              onSuccess: () => {
                setOpen(false);
                setSent(true);
              },
            })
          }
        />
      ) : (
        <Button
          variant="link"
          label={t('issues.report')}
          onPress={() => {
            setSent(false);
            setOpen(true);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, marginTop: 6, gap: 10 },
});
