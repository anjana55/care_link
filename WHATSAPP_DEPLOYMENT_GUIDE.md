# CareLink – WhatsApp sign-in release: deployment guide

This release adds WhatsApp one-time-code registration, login and account recovery for
caregivers and customers who have no email address. **Email/password sign-in is unchanged**
and WhatsApp sign-in is **off until an admin enables it**, so deploying this release does not
change behaviour for anyone by itself.

Contents of this archive: the full monorepo (`apps/api`, `apps/web`, `apps/public-web`,
`packages/shared`), Docker/Compose files, `setup.sh`, and the docs (`README.md` §7b,
`DEPLOYMENT.md` §8.5). It does **not** contain `node_modules`, build output, `.git` or any
`.env` file (so nothing secret ships in it).

> This guide covers what is specific to this release. The general server setup (Docker, DNS,
> HTTPS, backups) is in `DEPLOYMENT.md` and is not repeated here.

## What changes in the database (read this first)

Migration `0007_add_whatsapp_auth` runs on deploy and:

- makes `users.email` and `users.password_hash` **nullable** (WhatsApp users have neither);
- adds `users.phone` (unique, stored as `+94…`) and `users.phone_verified_at`;
- creates `whatsapp_otps` and `whatsapp_auth_settings`.

Existing rows are untouched, and existing users keep their email and password. The migration
is **not automatically reversible** – the way back is restoring a backup (see Rollback). Take
the backup in step 1 below.

---

## A. Fresh installation (new server)

1. Provision the server and install Docker as described in `DEPLOYMENT.md` Parts 1–5.
2. Extract the archive and run the installer:

   ```bash
   cd ~
   unzip care_link-whatsapp-complete.zip        # creates ~/care_link
   cd ~/care_link
   chmod +x setup.sh
   ./setup.sh
   ```

   `setup.sh` generates all secrets (including the new `SETTINGS_ENCRYPTION_KEY`), builds,
   starts, migrates and seeds. Follow its prompts; it is safe to re-run.
3. Sign in to the staff app as the initial admin, then continue at **"Enable WhatsApp
   sign-in"** below.

## B. Upgrading an existing installation

Run these on the server that hosts the current deployment. Replace `~/care_link` with your
install path. `COMPOSE` is just shorthand used in this guide:

```bash
cd ~/care_link
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.production"
```

### 1. Back up (do not skip – migration 0007 alters the `users` table)

```bash
$COMPOSE exec mysql sh -c 'exec mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" care_platform' \
  > "care_platform_backup_before_whatsapp_$(date +%F).sql"
ls -lh care_platform_backup_before_whatsapp_*.sql     # should be non-empty
```

Copy that file off the server. Also keep a copy of your current `.env.production`.

### 2. Put the new code in place

Keep your `.env.production` and Docker volumes; replace only the source.

```bash
cd ~
mv care_link care_link.previous                       # keep the old tree for rollback
unzip care_link-whatsapp-complete.zip                 # creates ~/care_link
cp care_link.previous/.env.production care_link/.env.production
cd care_link
```

If you deploy from git instead: `git pull` (or apply `whatsapp-auth.patch` with
`git apply`) and skip the move/copy above.

### 3. Add the one new setting to `.env.production`

Generate a key and set it (this encrypts the stored WhatsApp access token):

```bash
echo "SETTINGS_ENCRYPTION_KEY=$(openssl rand -base64 48)" >> .env.production
```

Everything else is optional. `.env.production.example` lists the optional `WHATSAPP_*`
lines; they only seed the admin settings the first time the API starts, so you can leave
them out. If you skip `SETTINGS_ENCRYPTION_KEY` the app falls back to a key derived from
`JWT_REFRESH_SECRET` – that works, but rotating that secret later would make the stored
token unreadable (you would just paste it again).

### 4. Rebuild, restart, migrate

```bash
$COMPOSE build
$COMPOSE up -d
$COMPOSE exec -w /app/apps/api api node dist/src/database/migrate.js
```

The migrate command prints `Migrations complete.` and is safe to repeat. No re-seed is
needed for this release.

### 5. Verify the upgrade

```bash
$COMPOSE ps                                           # all services running (healthy where a healthcheck exists)
curl -s https://YOUR-DOMAIN/api/auth/whatsapp/config   # JSON; "enabled": false  (the API is served under /api)
```

Then in a browser (customers: `https://YOUR-DOMAIN/`, staff/caregivers: `https://YOUR-DOMAIN/staff`): sign in with an existing **email** account (admin, staff, caregiver and a
customer if you have one) and confirm each still works. Check
**Settings → WhatsApp sign-in** appears in the admin sidebar (admin only).

At this point the release is deployed and nothing has changed for end users. Enable the
feature when you are ready:

## Enable WhatsApp sign-in

Prerequisites on the Meta side (one-off, details in `DEPLOYMENT.md` §8.5):

- a WhatsApp Business Account with a phone number → note the **Phone number ID** and
  **Business Account ID**;
- a permanent **System User access token** with `whatsapp_business_messaging`;
- an **approved Authentication-category message template** → note its exact name and
  language code.

Then, as an admin, open **Settings → WhatsApp sign-in**:

1. Delivery: choose *WhatsApp Business Cloud API (Meta)*; enter phone number ID, business
   account ID and access token.
2. Message template: enter the approved template's name and language (tick "copy code" only
   if the template has that button).
3. Review the OTP rules (defaults: 6 digits, 5 min lifetime, 5 attempts, 60 s resend wait,
   5 codes per number per hour) and the default country code (`94`).
4. **Save**, then **Send test** to your own number and confirm the message arrives.
5. Tick **Enable WhatsApp sign-in** (optionally limit it to caregivers or customers, or turn
   registration / login / recovery off individually) and **Save**.

The "WhatsApp" links now appear on the login and registration pages of both apps.

Do **not** use the *Console* provider in production – it logs codes instead of sending them,
and the API refuses to enable it when `NODE_ENV=production`.

## Post-deploy acceptance checklist

- [ ] Existing email login works for admin, staff, caregiver and customer.
- [ ] New email registration + verification still works (customer and caregiver).
- [ ] Admin can open Settings → WhatsApp sign-in; staff users cannot (403/redirect).
- [ ] *Send test* arrives on WhatsApp.
- [ ] Register a **customer** with a WhatsApp number → code arrives → verified → signed in.
- [ ] Register a **caregiver** with a WhatsApp number → code arrives → verified → profile
      appears in the staff app as DRAFT.
- [ ] Sign out, then sign in again with a fresh code; a wrong code is rejected; an expired
      code (wait past the lifetime) is rejected.
- [ ] Try registering the same number again → "already exists".
- [ ] *Lost access?* recovery works and signs the other device out.
- [ ] Switch the master toggle off → the WhatsApp links disappear and the endpoints return
      403; email login is unaffected. Switch it back on if desired.

## Rollback

*Before* you enable the feature (code deployed, migration applied): the old code still runs
against the migrated database, because the migration only relaxes and adds columns. Restore
the previous tree and rebuild:

```bash
cd ~ && mv care_link care_link.new && mv care_link.previous care_link && cd care_link
$COMPOSE build && $COMPOSE up -d
```

*After* WhatsApp users have registered, the old code cannot read their rows (no email), so a
full rollback means restoring the backup from step 1 (this **loses data created since the
backup**):

```bash
$COMPOSE exec -T mysql sh -c 'exec mysql -u root -p"$MYSQL_ROOT_PASSWORD" care_platform' \
  < care_platform_backup_before_whatsapp_YYYY-MM-DD.sql
```

The gentler alternative is simply to switch **Enable WhatsApp sign-in** off in the admin
screen – no redeploy needed.

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| Admin can't enable the feature: "Cannot enable WhatsApp sign-in without: …" | A required Meta field (phone number ID, access token or template name) is blank – fill it in and save. |
| "Console provider … choose Meta Cloud API" | Provider is set to Console while `NODE_ENV=production`. Switch to Meta. |
| *Send test* fails with "WhatsApp could not deliver the code" | Check `$COMPOSE logs api` for the Meta error code. Usual causes: expired/incorrect token, wrong phone number ID, template not approved yet, or template name/language mismatch. |
| Users never receive the code, but registration succeeds | The account is created first and the code sent second. Template/token problems show in the API log as "OTP delivery failed". The user can use *Send a new code* once it is fixed. |
| "Please wait N seconds before requesting another code" | Resend cooldown or hourly cap; adjust under OTP rules if too strict. |
| Stored access token seems lost after changing secrets | The token is encrypted with `SETTINGS_ENCRYPTION_KEY` (or `JWT_REFRESH_SECRET` if unset). Changing it makes the token unreadable; re-enter it in the admin screen. |
| `migrate.js` fails | Make sure the `mysql` container is healthy (`$COMPOSE ps`) and run it again; send the error text if it persists. |
| WhatsApp links don't appear | The feature is off, or that role/flow is switched off; check `GET https://YOUR-DOMAIN/api/auth/whatsapp/config`. |
