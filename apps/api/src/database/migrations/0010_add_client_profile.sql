-- Client profile fields, filled in by staff from the clients detail page
-- (PATCH /patients/:id, see PatientsService.update).
--
-- Every column is nullable with no default, unlike the caregiver equivalents.
-- A client does not arrive through an intake form: both self-registration
-- paths (AuthService.registerPatient and its WhatsApp twin) write only a name,
-- a phone and consent. So every existing row and every future WhatsApp signup
-- has all of these null, and NOT NULL here would mean either backfilling
-- invented data for every current client or a second migration later. Same
-- reasoning as 0005's consent_accepted_at.
--
-- district/city/province/postal_code are display caches the service writes from
-- the id pair in the same request (resolveLocationRefs), exactly as on
-- caregivers - a staff list renders from these without a join. The ids are the
-- source of truth; nothing matches on the names. patients additionally stores
-- province, which caregivers resolves and discards.
--
-- Deliberately ONE statement. MySQL commits DDL implicitly, so the migrator's
-- surrounding transaction cannot undo a partially applied migration; eleven
-- separate ALTERs would leave a half-migrated table if statement seven failed.
--
-- No new index. Caregivers' district index exists only as the leading column of
-- caregivers_public_search_idx, which serves public search - patients have no
-- public search, and nothing queries them by district. `nic` is deliberately
-- not unique either: a unique index would turn two staff mistyping the same NIC
-- into a raw ER_DUP_ENTRY 500 unless a pre-check helper shipped with it, and
-- MySQL allows unlimited NULLs so it can be tightened later without breakage.
ALTER TABLE `patients`
  ADD COLUMN `permanent_address` text,
  ADD COLUMN `date_of_birth` date,
  ADD COLUMN `gender` enum('MALE','FEMALE','OTHER'),
  ADD COLUMN `nic` varchar(20),
  ADD COLUMN `district_id` int,
  ADD COLUMN `city_id` int,
  ADD COLUMN `district` varchar(100),
  ADD COLUMN `city` varchar(100),
  ADD COLUMN `province` varchar(100),
  ADD COLUMN `postal_code` varchar(20),
  ADD COLUMN `notes` text;