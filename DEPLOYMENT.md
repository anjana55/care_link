# Deployment Guide

This guide assumes **nothing**. It assumes you have never used Docker
before, never pointed a domain at a server before, and might not know
what half these words mean. Every command is written out in full. Every
command tells you what it does, and what you should see happen after you
run it. If something on your screen doesn't match what's described here,
skip to **Part 8 - Troubleshooting** and look for the exact error text.

Follow the parts **in order**. Don't skip ahead - Part 5 (the port-80
fix) exists specifically because someone hit that exact error while
following an earlier version of this guide, and doing it before you
need it saves you the confusion later.

---

## Contents

- [Part 0 - Words used in this guide](#part-0---words-used-in-this-guide)
- [Part 1 - What you need before you start](#part-1---what-you-need-before-you-start)
- [Part 2 - Connect to your server](#part-2---connect-to-your-server)
- [Part 3 - Get the code onto the server](#part-3---get-the-code-onto-the-server)
- [Part 4 - Install Docker](#part-4---install-docker)
- [Part 5 - Fix the port-80 permission issue in advance](#part-5---fix-the-port-80-permission-issue-in-advance)
- [Part 6 - Open your firewall / cloud security group](#part-6---open-your-firewall--cloud-security-group)
- [Part 7 - Point your domain at the server](#part-7---point-your-domain-at-the-server)
- [Part 8 - Fill in your secrets](#part-8---fill-in-your-secrets)
- [Part 9 - Build the images](#part-9---build-the-images)
- [Part 10 - Start everything](#part-10---start-everything)
- [Part 11 - Run the database migrations](#part-11---run-the-database-migrations-one-time-step)
- [Part 12 - Check that it actually worked](#part-12---check-that-it-actually-worked)
- [Part 13 - Add HTTPS (the padlock icon)](#part-13---add-https-the-padlock-icon)
- [Part 14 - Everyday commands](#part-14---everyday-commands-cheat-sheet)
- [Part 15 - Backups](#part-15---backups)
- [Part 16 - Updating to a newer version later](#part-16---updating-to-a-newer-version-later)
- [Part 17 - Troubleshooting](#part-17---troubleshooting)

---

## Part 0 - Words used in this guide

Skip this if you already know Docker/Linux basics. If you don't, read it
once - every later step will make more sense.

- **Terminal** - the black/white text window where you type commands.
  You're already using one if you followed the earlier steps.
- **Server** - the computer, somewhere on the internet, that will run
  this app 24/7. It's not your laptop.
- **SSH** - the tool you use to "log in" to your server from your
  laptop's terminal and type commands on it remotely.
- **Docker** - a program that runs software inside sealed, self-contained
  boxes called **containers**, so it behaves the same on your server as
  it did anywhere else it was tested.
- **Container** - one running instance of a sealed box (see above). This
  app uses five: the database, the API, the two websites, and a traffic
  director (nginx).
- **Image** - the "recipe" a container is built from. You **build** an
  image once, then **start** (as many) containers from it as you like.
- **`docker compose`** - a tool that starts/stops/manages *several*
  containers together, described in one file (`docker-compose.prod.yml`),
  instead of you typing a separate command for each one.
- **`sudo`** - "do this as the administrator." Linux normally stops you
  from doing risky things by accident; typing `sudo` in front of a
  command is you saying "yes, I mean it."
- **Environment variable / `.env` file** - a setting read by the app at
  startup (a password, a web address, etc.) that's kept in a separate
  file instead of typed directly into the code, so secrets don't end up
  visible in the source code.
- **Domain / DNS / "A record"** - your domain (`yourdomain.example`) is
  just a human-friendly name. An **A record** is the entry you add at
  wherever you bought the domain that says "this name points at this
  server's numeric address." Without it, nobody can reach your server by
  typing your domain name.
- **Port** - a numbered "door" on your server that a program listens on.
  Web traffic normally uses port 80 (plain) and 443 (secure/HTTPS).

---

## Part 1 - What you need before you start

Tick these off. Don't move to Part 2 until every box is true.

- [ ] **A server you can reach over SSH**, running Ubuntu (this guide is
      written for Ubuntu specifically - the exact commands below assume
      it). If you're on AWS EC2, this is an Ubuntu instance you've
      launched and can already `ssh` into. (Everything you pasted so far
      shows you're on AWS EC2 with Ubuntu - good, you already have this.)
- [ ] **A domain name you own** (e.g. bought from Namecheap, GoDaddy,
      Route 53, etc.) that you can add DNS records to. You *can* skip
      this and use the server's plain IP address instead, but then you
      cannot get a padlock/HTTPS (Part 13) - only do that for a temporary
      test, never for anything real.
- [ ] **This app's source code**, either as the `.zip` you were given, or
      as a link to its git repository.
- [ ] About **45-60 minutes**, mostly spent waiting for downloads/builds,
      not typing.

Nothing else. You do not need to know Docker, Linux, or this codebase
already - every command from here is copy-paste-ready.

---

## Part 2 - Connect to your server

On **your own laptop**, open a terminal and connect:

```bash
ssh ubuntu@YOUR_SERVER_IP
```

Replace `YOUR_SERVER_IP` with your server's actual address (you already
have this working, since your prompt shows
`ubuntu@ip-172-31-31-120:~/care_link$`).

**Everything from here on is typed on the server**, inside that SSH
session - not on your laptop. Keep that terminal window open for the
rest of this guide.

Confirm where you are:

```bash
pwd
```

This prints your current folder (e.g. `/home/ubuntu`). Good - you're in.

---

## Part 3 - Get the code onto the server

You already have a copy of the project (your prompt shows you're inside
`~/care_link`). If you ever need to do this from scratch on a *new*
server, here's how:

```bash
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/anjana55/care_platform.git care_link
cd care_link
```

- `sudo apt-get update` - refreshes the list of installable software.
  Expect a screen of text scrolling by; that's normal.
- `sudo apt-get install -y git` - installs `git`, the tool used to
  download source code. The `-y` means "yes, install it, don't ask me to
  confirm."
- `git clone ...` - downloads the actual project into a new folder
  named `care_link`.
- `cd care_link` - moves your terminal *into* that folder. Every command
  in the rest of this guide is run from inside this folder. If you ever
  get an error that mentions a missing file, run `pwd` and check you're
  actually inside the project folder.

If you already have the code (which you do), just make sure you're
inside it:

```bash
cd ~/care_link
ls
```

`ls` lists the files in the folder. You should see, among others:
`docker-compose.prod.yml`, `DEPLOYMENT.md` (this file), `apps`, and
`deploy`. If you don't see those, you're in the wrong folder - find the
right one before continuing.

---

## Part 4 - Install Docker

Check first whether it's already installed:

```bash
docker --version
```

- If that prints something like `Docker version 27.x.x, build ...` -
  Docker is installed, skip to the next command below (`docker compose
  version`) to check that too, then move to Part 5.
- If it prints `command not found` - install it:

```bash
curl -fsSL https://get.docker.com | sh
```

This downloads and runs Docker's official install script. It will print
a lot of output over 1-3 minutes. That's expected.

Now let your normal user run Docker without typing `sudo` every time:

```bash
sudo usermod -aG docker $USER
```

**This does not take effect until you reconnect.** Close your SSH
session and open a new one:

```bash
exit
```
then, back on your laptop:
```bash
ssh ubuntu@YOUR_SERVER_IP
cd ~/care_link
```

Now confirm everything works:

```bash
docker --version
docker compose version
docker run hello-world
```

- The first two should print version numbers, no errors.
- `docker run hello-world` downloads a tiny test image and runs it. You
  should see a paragraph starting with **"Hello from Docker!"**. If you
  see that, Docker is fully working. If you get a `permission denied`
  error here, you skipped the "close and reopen your SSH session" step
  above - go back and actually do it (not just `cd` again in the same
  window).

---

## Part 5 - Fix the port-80 permission issue in advance

Some servers run Docker in a mode ("rootless") that, by default, isn't
allowed to use port 80 or 443 (the standard web ports) - even though
everything else works fine. If you skip this step, you likely won't see
a problem until much later (Part 10), when the `nginx` container - the
one responsible for actually letting the outside world reach your site
- fails with an error like:

```
cannot expose privileged port 80, ... permission denied
```

Fix it now, once, so you never see that:

```bash
echo 'net.ipv4.ip_unprivileged_port_start=80' | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

- The first command adds one line to a system settings file, allowing
  *any* program (not just ones running as root) to use ports starting
  from 80.
- `sudo sysctl -p` applies it immediately, without needing a reboot.

This is completely safe to run whether or not you actually needed it -
if your Docker install didn't have this restriction, these two commands
simply do nothing harmful.

---

## Part 6 - Open your firewall / cloud security group

The app also needs the *outside world* to be allowed to reach your
server on ports 80 and 443. This is separate from anything inside the
server itself - it's a setting on whatever service is hosting your
server.

**If you're on AWS EC2** (your prompt strongly suggests you are):

1. Open the [AWS Console](https://console.aws.amazon.com/ec2/), go to
   **EC2 → Instances**, click your instance.
2. Click the **Security** tab, then click the security group link shown
   there.
3. Click **Edit inbound rules → Add rule**, and add:
   - Type: `HTTP`, Port: `80`, Source: `Anywhere (0.0.0.0/0)`
   - Type: `HTTPS`, Port: `443`, Source: `Anywhere (0.0.0.0/0)`
4. Click **Save rules**.

**If you're on a different provider** (DigitalOcean, Linode, Hetzner,
GCP, Azure, a bare server with `ufw`, etc.) - look for a setting called
"Firewall," "Security Group," or "Cloud Firewall" in that provider's
dashboard, and make sure inbound traffic on ports **80** and **443** is
allowed from anywhere. If you're using `ufw` directly on the server
itself instead of a cloud firewall:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

Skipping this step is the single most common reason a deployment
"looks" successful (all containers running, no errors) but the website
doesn't load in a browser.

---

## Part 7 - Point your domain at the server

Skip this whole part - and use your server's plain IP address in every
later step instead of `yourdomain.example` - if you don't have a domain
yet and just want to test things. You will not be able to do Part 13
(HTTPS) without a domain, though.

1. Find your server's public IP address:
   ```bash
   curl -s https://checkip.amazonaws.com
   ```
   This prints just the IP address, e.g. `54.123.45.67`.

2. Go to wherever you bought/manage your domain (your registrar's
   website), find its **DNS settings** page, and add a record:
   - **Type**: `A`
   - **Name/Host**: `@` (means the bare domain) - or a subdomain like
     `app` if you want `app.yourdomain.example` instead
   - **Value/Points to**: the IP address from step 1
   - **TTL**: leave default, or `300` (5 minutes) if asked

3. **Wait.** DNS changes aren't instant - anywhere from 1 minute to a
   few hours. Check whether it's ready with:
   ```bash
   nslookup yourdomain.example
   ```
   (replace with your real domain). Once the `Address:` line at the
   bottom shows the same IP from step 1, it's ready. If it shows nothing
   or a different IP, wait a bit longer and try again.

**Do not continue to Part 8 until this matches.** Every step after this
uses your domain name, and none of it will work until this points
correctly.

---

## Part 8 - Fill in your secrets

```bash
cp .env.production.example .env.production
nano .env.production
```

`nano` opens a simple in-terminal text editor. Use your arrow keys to
move around - do not use your mouse. When you're done editing (see
below), press `Ctrl+X`, then `Y`, then `Enter` to save and exit.

You'll see a file with lines like `DOMAIN=yourdomain.example`. Change
**every single value described below**. Do not leave any of them as the
placeholder text - the app will refuse to start (on purpose - see Part
17) if you do.

### 8.1 Your domain

Replace every occurrence of `yourdomain.example` in the file with your
**real** domain from Part 7 (e.g. `example.com`, or `app.example.com` if
you used a subdomain). There are several lines that mention it - change
all of them, not just the first one.

If you're skipping Part 7 and testing with a plain IP address instead,
use `http://YOUR_SERVER_IP` (no `https://`, and no domain) in place of
every `https://yourdomain.example` value - but read the note at the
start of Part 7 first: HTTPS won't work this way.

### 8.2 Passwords and secret keys

These lines need long random values, not something you make up:

```
MYSQL_PASSWORD=
MYSQL_ROOT_PASSWORD=
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
```

**Open a second terminal window** (leave `nano` open in the first one),
connect to your server again the same way as Part 2, and run this once
for each of the four lines above:

```bash
openssl rand -base64 32
```

This prints a random string, e.g. `Xz3k9Lp2Qw...`. Copy the exact text
it prints (select it with your mouse, right-click → copy, or however
your terminal app copies text). Run it four separate times, so each
secret is a **different** random value - never reuse one.

Back in your first terminal (the one with `nano` still open), paste each
generated value after its matching `=` sign, so a line goes from:
```
MYSQL_PASSWORD=
```
to something like:
```
MYSQL_PASSWORD=Xz3k9Lp2Qw7fH1nRtVb8...
```
Do this for all four lines. When done, you no longer need the second
terminal window - you can close it.

### 8.3 What the file should look like when you're done

Every line should have a real value after the `=` sign - nothing should
still say `yourdomain.example` or be blank. As an example (**do not
copy these exact values** - they're just here to show the *shape* of a
filled-in file):

```
DOMAIN=example.com
MYSQL_DATABASE=care_platform
MYSQL_USER=care_app
MYSQL_PASSWORD=Xz3k9Lp2Qw7fH1nRtVb8Zc4Ym6Wp
MYSQL_ROOT_PASSWORD=Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr
CORS_ORIGIN=https://example.com
CAREGIVER_WEB_URL=https://example.com/staff
PUBLIC_WEB_URL=https://example.com
JWT_ACCESS_SECRET=9fTgH2kLpQwErTyUiOpAsDfGhJkLzXc
JWT_REFRESH_SECRET=1qAzWsXeDcRfVgTbYhNmJuIkOlP0987z
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
STORAGE_DRIVER=local
STORAGE_MAX_FILE_SIZE_BYTES=10485760
THROTTLE_TTL=60
THROTTLE_LIMIT=100
NEXT_PUBLIC_API_URL=https://example.com/api
```

Save and exit `nano` now: press `Ctrl+X`, then `Y`, then `Enter`.

Double-check it saved correctly:

```bash
cat .env.production
```

This prints the file's contents back to you. Read through it once -
does every line have a real value, with no leftover `yourdomain.example`
or blank `=` at the end of any line? If yes, move on.

---

## Part 9 - Build the images

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production build
```

This reads the three `Dockerfile`s in the project and turns them into
runnable images. **This step is slow the first time** - expect
5-15 minutes depending on your server's size, since it's downloading and
compiling everything from scratch. You'll see a lot of scrolling text;
that's normal.

You'll know it worked when the command finishes and returns you to a
normal prompt (`ubuntu@...:~/care_link$`) with **no red error text** at
the end. If you see red text ending the command, go to Part 17.

---

## Part 10 - Start everything

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

The `-d` means "detached" - it starts everything in the background and
gives you your prompt back immediately, instead of sitting there
showing logs forever.

You should see a list of 5 items (`mysql`, `api`, `web`, `public-web`,
`nginx`), each ending in a green checkmark and a word like `Created`,
`Started`, or `Healthy`.

Confirm all 5 are actually running:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production ps
```

You should see 5 rows, and every row's `STATUS` column should say
`Up ...` (for `mysql`, it should say `Up ... (healthy)`). If any row is
missing, or says `Exited` or `Restarting`, go to Part 17 - do not
continue to Part 11 until all 5 rows say `Up`.

---

## Part 11 - Run the database migrations (one-time step)

The database starts out completely empty - this step creates all its
tables. Run this exact command:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec -w /app/apps/api api node dist/src/database/migrate.js
```

You should see:
```
Running migrations from ./src/database/migrations ...
Migrations complete.
```

If instead you see `service "api" is not running`, it means Part 10
didn't actually finish successfully for the `api` container specifically
- go back, run the `ps` command from Part 10 again, and check `api`'s
row says `Up`. Don't re-run the migration command until it does.

You only need to run this once per fresh database. If you ever update
the app later and it adds new database changes, Part 16 tells you when
to run this again.

---

## Part 12 - Check that it actually worked

From your **server's** terminal:

```bash
curl -I https://yourdomain.example/
```

(replace with your real domain from Part 7, or `http://YOUR_SERVER_IP`
if you're testing without one). You're looking for the very first line
of the output to say `HTTP/1.1 200` or `HTTP/2 200` - `200` means
"success."

Now, on **your own laptop** (not the server), open a normal web browser
and visit your domain. You should see the CareLink Finder homepage - a
search box for finding caregivers.

Also check the staff app and the sign-up page:
- `https://yourdomain.example/staff/login` - should show a staff login
  form.
- `https://yourdomain.example/register` - should show the patient/
  guardian sign-up page with a hero banner placeholder at the top.

If any of these don't load in your browser but the `curl` command above
worked, the problem is almost always Part 6 (firewall/security group) or
Part 7 (DNS) - double check both.

---

## Part 13 - Add HTTPS (the padlock icon)

Right now your site loads over plain `http://`, not the secure
`https://` shown in the examples above - browsers will show a "Not
Secure" warning, and some features (like copying a password) may be
blocked by the browser until this is fixed. This part gets you a free,
auto-renewing certificate with **no manual certificate steps** by
swapping the traffic-director container from `nginx` to `caddy`, which
handles HTTPS completely automatically.

**You need a working domain (Part 7) for this - it will not work with a
plain IP address.**

### 13.1 Create the Caddy configuration file

```bash
nano deploy/Caddyfile
```

Paste in exactly this (replace `yourdomain.example` with your real
domain - just that one line at the top):

```
yourdomain.example {
    handle /staff/* {
        reverse_proxy web:3000
    }
    handle /api/* {
        reverse_proxy api:3001
    }
    handle {
        reverse_proxy public-web:3000
    }
}
```

Save and exit: `Ctrl+X`, then `Y`, then `Enter`.

### 13.2 Swap nginx for Caddy in the compose file

```bash
nano docker-compose.prod.yml
```

Find this block (near the bottom):

```yaml
  nginx:
    image: nginx:1.27-alpine
    restart: unless-stopped
    depends_on:
      - api
      - web
      - public-web
    ports:
      - '80:80'
    volumes:
      - ./deploy/nginx.conf:/etc/nginx/conf.d/default.conf:ro
```

Replace that **entire block** (all of it, from `nginx:` down to the end
of its `volumes:` line) with:

```yaml
  caddy:
    image: caddy:2.8-alpine
    restart: unless-stopped
    depends_on:
      - api
      - web
      - public-web
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - ./deploy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
```

Then find the `volumes:` section at the very bottom of the file (it
currently lists `mysql-data:` and `caregiver-documents:`), and add two
more lines so it looks like:

```yaml
volumes:
  mysql-data:
  caregiver-documents:
  caddy-data:
  caddy-config:
```

Save and exit: `Ctrl+X`, then `Y`, then `Enter`.

### 13.3 Restart with the new setup

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

The first time Caddy starts, it automatically requests a free
certificate from Let's Encrypt for your domain - this takes a few
seconds to a couple of minutes. Watch it happen:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f caddy
```

(Press `Ctrl+C` to stop watching - this doesn't stop the container,
just the log view.) Look for a line mentioning `certificate obtained`
or `serving initial configuration`. Once you see that, visit
`https://yourdomain.example` in your browser - you should now see a
padlock icon with no warning.

---

## Part 14 - Everyday commands cheat-sheet

Run all of these from inside the `~/care_link` folder.

| What you want to do | Command |
|---|---|
| See what's running | `docker compose -f docker-compose.prod.yml --env-file .env.production ps` |
| Watch live logs (all services) | `docker compose -f docker-compose.prod.yml --env-file .env.production logs -f` |
| Watch live logs (just the api) | `docker compose -f docker-compose.prod.yml --env-file .env.production logs -f api` |
| Stop everything | `docker compose -f docker-compose.prod.yml --env-file .env.production down` |
| Start everything again | `docker compose -f docker-compose.prod.yml --env-file .env.production up -d` |
| Restart just one service | `docker compose -f docker-compose.prod.yml --env-file .env.production restart api` |

`logs -f` keeps running until you press `Ctrl+C` - that only stops the
log view, it does not stop the app.

---

## Part 15 - Backups

Two things need regular backing up. Neither happens automatically - you
need to set up a schedule yourself (see the note at the end of this
part).

### 15.1 Back up the database

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec mysql sh -c 'exec mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" care_platform' \
  > "care_platform_backup_$(date +%F).sql"
```

This creates a file like `care_platform_backup_2026-09-27.sql` in your
current folder, containing every row in the database. Copy this file
somewhere *other* than this server regularly (download it to your
laptop, upload it to cloud storage, etc.) - a backup that lives only on
the same server it's backing up doesn't protect you if that server is
lost.

### 15.2 Back up uploaded documents

Caregivers' uploaded documents (qualifications, ID scans, etc.) live in
a separate place. First, find its exact name:

```bash
docker volume ls
```

Look for a line ending in `caregiver-documents` (it'll be prefixed with
your folder's name, e.g. `care_link_caregiver-documents`). Then:

```bash
docker run --rm \
  -v care_link_caregiver-documents:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/documents_backup_$(date +%F).tar.gz -C /data .
```

(replace `care_link_caregiver-documents` with whatever `docker volume
ls` actually showed you).

### 15.3 Automate it

Doing this by hand isn't a real backup strategy - you'll forget. Set up
a scheduled task (`cron`) to run both commands nightly, and make the
schedule also copy the resulting files somewhere off this server. If
you're not sure how to set up `cron`, that's a reasonable next thing to
ask for help with once the app itself is running.

---

## Part 16 - Updating to a newer version later

When you get new code changes for this app:

```bash
cd ~/care_link
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production build
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

Then, **only if you were told new database changes were included**:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec -w /app/apps/api api node dist/src/database/migrate.js
```

If you're not sure whether new database changes were included, it's
always safe to run this command anyway - it silently does nothing if
there's nothing new to apply.

---

## Part 17 - Troubleshooting

Find the error text you actually saw and read the matching entry. If
nothing here matches exactly, scroll to **17.9 - Getting more help**.

### 17.1 `cannot expose privileged port 80 ... permission denied`

This is the exact error covered by Part 5. Run the two commands in Part
5, then re-run the `up -d` command from Part 10.

### 17.2 `service "api" is not running` (or "web", "mysql", etc.)

Something in that service's container isn't actually up. Check the full
picture:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production ps -a
```

The `-a` shows *every* container including stopped ones (the plain `ps`
in earlier parts hides those). Find the row for the service named in
the error. If its `STATUS` says `Exited (1)` or similar, read that
service's logs to see why:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production logs api
```

(replace `api` with whichever service is broken). Look for a line
starting with `Error` near the bottom. Common causes: a value in
`.env.production` is still blank or wrong (go back to Part 8), or
`mysql` wasn't ready yet when `api` tried to start (rare - restart it
with `docker compose -f docker-compose.prod.yml --env-file
.env.production restart api`).

### 17.3 `permission denied` when running any `docker` command

You ran `sudo usermod -aG docker $USER` in Part 4 but didn't fully log
out and back in afterwards - just running `cd` again in the same window
isn't enough. Type `exit`, then reconnect with `ssh` from scratch.

### 17.4 `Cannot connect to the Docker daemon`

Docker itself isn't running. Try:

```bash
sudo systemctl start docker
```

then retry whatever command failed.

### 17.5 `Bind for 0.0.0.0:80 failed: port is already allocated`

Something else on your server is already using port 80 (maybe a default
Apache/nginx install that came with your server image). Find and stop
it:

```bash
sudo lsof -i :80
```

This lists whatever's using port 80 and its process name. If it's a
system web server you don't need (commonly `apache2` or `nginx` as a
system service, not the Docker one), stop it:

```bash
sudo systemctl stop apache2   # or: sudo systemctl stop nginx
sudo systemctl disable apache2 # or: sudo systemctl disable nginx
```

then retry the `up -d` command.

### 17.6 A variable is "not set" error during `up -d` or `build`

Something like:
```
error while interpolating services.api.environment.[8]: required variable MYSQL_PASSWORD is missing a value
```

Go back to Part 8 - one of the lines in `.env.production` is still
blank. Also double-check you're passing `--env-file .env.production` on
every command (not `.env` or nothing) - this file is only read when
that flag is present.

### 17.7 The build step (Part 9) fails partway through

Most common cause on small servers: it ran out of memory or disk space.
Check disk space:

```bash
df -h /
```

If `Avail` is close to `0` on the `/` line, you need a bigger disk or to
free up space (remove old files, or resize the server's storage). Check
memory:

```bash
free -h
```

If this is a very small server (1 GB RAM or less), the build may simply
need more memory than you have - consider a larger server size, at
least temporarily for the build.

### 17.8 The site loads on the server itself but not in my browser

This is almost always Part 6 (firewall/cloud security group) or Part 7
(DNS not pointed correctly, or not finished propagating yet). Re-check
both. Also confirm you're typing the domain correctly in your browser,
including `https://` once you've done Part 13 (before that, use plain
`http://`).

### 17.9 Getting more help

If you're still stuck, gather this information before asking for help -
it's what anyone helping you will need first:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production ps -a
docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail=50
```

Copy the **full text** of both outputs (not a summary of what you think
it means) along with the exact command you ran and the exact error you
saw.
