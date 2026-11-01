-- Account deletion audit entries were filed against the login (entity User,
-- or AccountDeletionRequest for a cancellation), so they never showed on the
-- caregiver's or client's Audit tab. Move them onto that record, as new
-- entries are now written.
UPDATE `audit_logs` a
JOIN `account_deletion_requests` r ON a.`entity_id` = r.`user_id`
SET a.`entity_type` = IF(r.`caregiver_id` IS NOT NULL, 'Caregiver', 'Patient'),
    a.`entity_id` = COALESCE(r.`caregiver_id`, r.`patient_id`)
WHERE a.`action` IN ('REQUEST_ACCOUNT_DELETION', 'ERASE_ACCOUNT')
  AND a.`entity_type` = 'User'
  AND COALESCE(r.`caregiver_id`, r.`patient_id`) IS NOT NULL;
--> statement-breakpoint
UPDATE `audit_logs` a
JOIN `account_deletion_requests` r ON a.`entity_id` = r.`id`
SET a.`entity_type` = IF(r.`caregiver_id` IS NOT NULL, 'Caregiver', 'Patient'),
    a.`entity_id` = COALESCE(r.`caregiver_id`, r.`patient_id`)
WHERE a.`action` = 'CANCEL_ACCOUNT_DELETION'
  AND a.`entity_type` = 'AccountDeletionRequest'
  AND COALESCE(r.`caregiver_id`, r.`patient_id`) IS NOT NULL;
