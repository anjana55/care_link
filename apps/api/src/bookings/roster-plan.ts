/**
 * The roster rule for editing a booking lives in @care-platform/shared, so the
 * staff form's preview ("12 kept, 3 cancelled, 2 added") and the API apply the
 * very same rule. Re-exported here for the bookings service and its tests.
 */
export { planRoster, type PlannableShift, type RosterPlan } from '@care-platform/shared';
