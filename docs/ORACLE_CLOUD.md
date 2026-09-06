# Deploying Marcia Recipe to Oracle Cloud (Always Free)

This guide walks you through deploying Marcia Recipe on **Oracle Cloud's Always Free tier** at
zero cost, using a Dockerized single instance behind Caddy for automatic HTTPS.

**Time to complete:** ~45–60 minutes (mostly waiting for instance provisioning and DNS propagation).

**Result:** A public, HTTPS-secured Marcia Recipe instance at `https://recipes.yourdomain.com`,
running on an Ampere ARM VM with persistent Docker volume storage.

---

## What you get on Always Free

| Resource | Always Free allowance |
| --- | --- |
| **Ampere A1 Flex** compute | 2 OCPUs / 12 GB RAM total (1 or 2 instances) |
| **AMD E2.1.Micro** compute | 2 instances, 1/8 OCPU + 1 GB each |
| Block volume storage | 200 GB total (boot + data) |
| Object storage | 10 GB |
| Outbound data transfer | 10 TB/month |

**Recommendation:** Use the **Ampere A1 Flex ARM** shape. The AMD micro (1 GB RAM) is too small
for Next.js + Docker and will swap constantly. Even 1 OCPU / 6 GB on A1 is ample for Marcia
Recipe.

---

## Prerequisites

- A domain name you control (or a free subdomain from a service like DuckDNS)
- A SSH key pair (generate one if you don't have it — see Step 3)
- The Marcia Recipe repository on your local machine

---

## Step 1 — Create an Oracle Cloud account

1. Go to **https://cloud.oracle.com/free** (the `/free` path ensures Always Free enrollment)
2. Click **Start for Free**
3. **Choose your home region carefully** — this is permanent and cannot be changed later. Pick
   one with good A1 Flex availability (Ashburn, Chicago, or your geographically closest region).
   See "Troubleshooting" if you hit capacity errors.
4. Provide email, password, and tenancy name
5. Complete identity verification (credit card required for identity check — **you will not be
   charged** as long as you stay within Always Free limits)
6. Verify your email and sign in to the OCI console

---

## Step 2 — Create an Ampere A1 Flex instance

1. In the OCI console, open the navigation menu → **Compute** → **Instances** → **Create Instance**
2. **Name:** `marcia-recipe`
3. **Image:** click **Change Image** → select **Ubuntu 24.04 Minimal (aarch64)** (or Ubuntu 22.04
   Minimal). Confirm the architecture label says **aarch64 / ARM64**, not AMD64.
4. **Shape:** click **Change Shape** → **Ampere** → **VM.Standard.A1.Flex** → configure:
   - **OCPUs:** `2` (or `1` to be conservative)
   - **Memory:** `12` GB (or `6` for 1 OCPU)
   - Confirm **"Always Free eligible"** appears below the shape
5. **SSH keys:** under **Add SSH keys**, choose **Paste SSH keys** and paste your public key
   (see Step 3 if you need to generate one). Alternatively, choose **Generate a key pair for me**
   and download the private key.
6. **Networking:** select **Assign a public IP address**. Use the **"Start with a VCN"** wizard
   if no VCN exists — it creates a VCN, public subnet, internet gateway, and route table.
7. **Boot volume:** leave at default 50 GB (Balanced performance). This counts against your
   200 GB block volume pool.
8. Click **Create**. Provisioning takes 1–3 minutes.
9. Note the **Public IP** once the instance shows "Running".

### Generate an SSH key pair (if needed)

On your local machine:

```sh
ssh-keygen -t ed25519 -C "marcia-recipe" -f ~/.ssh/oracle_key -N ""
```

This creates `~/.ssh/oracle_key` (private) and `~/.ssh/oracle_key.pub` (public). Paste the
**public** key into the OCI console.

---

## Step 3 — Open firewall ports (two layers)

Oracle has **two** firewalls that both must allow traffic. This is the #1 cause of "I opened
the port but it's still blocked."

### Layer 1 — OCI Security List (virtual network)

1. Console → **Networking** → **Virtual Cloud Networks** → click your VCN → **Public Subnet**
   → **Default Security List** → **Add Ingress Rules**
2. Add three rules (one per port):

| Source CIDR | Protocol | Destination Port | Purpose |
| --- | --- | --- | --- |
| `0.0.0.0/0` | TCP | 22 | SSH |
| `0.0.0.0/0` | TCP | 80 | HTTP (Caddy/Let's Encrypt) |
| `0.0.0.0/0` | TCP | 443 | HTTPS |

Egress is already open by default (all traffic to `0.0.0.0/0`) — no egress changes needed.

> **Note:** Oracle blocks outbound port 25 at the infrastructure level. This cannot be
> overridden. Marcia Recipe does not send email, so this is not an issue.

### Layer 2 — OS firewall (inside the instance)

SSH into the instance:

```sh
ssh -i ~/.ssh/oracle_key ubuntu@<PUBLIC_IP>
```

**On Ubuntu (UFW):**

```sh
sudo apt update && sudo apt upgrade -y
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo ufw status
```

UFW rules persist across reboots automatically.

**On Oracle Linux 9 (firewalld) — only if you chose OL9 instead of Ubuntu:**

```sh
sudo firewall-cmd --permanent --zone=public --add-service=http
sudo firewall-cmd --permanent --zone=public --add-service=https
sudo firewall-cmd --reload
sudo firewall-cmd --list-services --zone=public
# Should show: ssh http https dhcpv6-client
```

### Verify ports are reachable (from your local machine)

```sh
nc -zv <PUBLIC_IP> 80
nc -zv <PUBLIC_IP> 443
nc -zv <PUBLIC_IP> 22
```

If 80/443 still fail after both layers, double-check the OCI Security List — both layers must
allow the traffic.

---

## Step 4 — Install Docker

On the instance (Ubuntu):

```sh
# Prerequisites
sudo apt install -y ca-certificates curl

# Add Docker's official GPG key
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# Add Docker repository (auto-detects arm64 on A1)
sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Add your user to the docker group (log out/in after, or use newgrp)
sudo usermod -aG docker $USER
newgrp docker

# Enable and start Docker
sudo systemctl enable --now docker

# Verify — pulls an arm64 image natively, no QEMU
docker run --rm hello-world
docker info | grep Architecture   # should show aarch64
```

> **ARM compatibility:** The Marcia Recipe `Dockerfile` uses `node:22-bookworm-slim`, which is
> published for `linux/arm64`. No cross-compilation needed — Docker pulls the correct
> architecture automatically.

---

## Step 5 — Install Caddy (TLS reverse proxy)

Caddy automatically provisions and renews Let's Encrypt certificates.

```sh
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
sudo chmod o+r /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

Caddy installs as a systemd service and starts automatically on port 80/443.

---

## Step 6 — Point your domain at the instance

At your DNS provider, create an **A record**:

```
recipes.yourdomain.com   A   <OCI_PUBLIC_IP>
```

Wait for propagation (typically 5–15 minutes, up to 48 hours). Verify:

```sh
dig +short recipes.yourdomain.com
# Should return your OCI public IP
```

---

## Step 7 — Transfer the project to the instance

From your local machine, in the project root:

```sh
rsync -avz --exclude node_modules --exclude .next --exclude .git \
  --exclude data --exclude data.locks --exclude local \
  -e "ssh -i ~/.ssh/oracle_key" \
  ./* ubuntu@<PUBLIC_IP>:/home/ubuntu/marcia-recipe/
```

Alternatively, if you have pushed the repo to GitHub:

```sh
ssh -i ~/.ssh/oracle_key ubuntu@<PUBLIC_IP>
git clone https://github.com/<you>/Marcia_Recipe.git /home/ubuntu/marcia-recipe
```

---

## Step 8 — Create the environment file

SSH into the instance and create `.env`:

```sh
ssh -i ~/.ssh/oracle_key ubuntu@<PUBLIC_IP>
cd ~/marcia-recipe
```

Generate strong secrets and write the env file:

```sh
AUTH_SECRET=$(openssl rand -base64 48)
SETUP_TOKEN=$(openssl rand -hex 16)

cat > .env <<EOF
NODE_ENV=production
HOSTNAME=0.0.0.0
PORT=3000
DATA_ROOT=/data/marcia-recipe
AUTH_SECRET=$AUTH_SECRET
SETUP_TOKEN=$SETUP_TOKEN
APP_ORIGIN=https://recipes.yourdomain.com
EOF

chmod 600 .env
echo "Your SETUP_TOKEN is: $SETUP_TOKEN   (save this — you need it for first-run setup)"
```

> **Save the `SETUP_TOKEN` value** — you will enter it once at `/setup` to create the owner
> account. Web setup is disabled after the first owner exists.

---

## Step 9 — Build and start the container

```sh
cd ~/marcia-recipe
docker compose build
docker compose up -d
docker compose ps
docker compose logs -f app
```

The app listens on port 3000 inside the container, mapped to port 3000 on the host. The named
volume `marcia_recipe_data` is mounted at `/data/marcia-recipe` and persists across container
restarts and upgrades.

Verify the health endpoint:

```sh
curl -s http://127.0.0.1:3000/api/health
```

---

## Step 10 — Configure Caddy for HTTPS

```sh
sudo tee /etc/caddy/Caddyfile <<'EOF'
recipes.yourdomain.com {
    reverse_proxy 127.0.0.1:3000
}
EOF

sudo systemctl reload caddy
sudo systemctl status caddy
```

Caddy automatically:
- Provisions a Let's Encrypt TLS certificate (uses ports 80/443 for the challenge)
- Redirects HTTP → HTTPS
- Renews the certificate in the background (~every 60 days)

Check the logs if certificate provisioning fails:

```sh
sudo journalctl -u caddy --no-pager -n 50
```

### Verify from your local machine

```sh
curl -I https://recipes.yourdomain.com
# Should show HTTP/2 200
```

Open `https://recipes.yourdomain.com` in a browser.

---

## Step 11 — First-run setup

1. Visit `https://recipes.yourdomain.com/setup`
2. Enter your `SETUP_TOKEN` (from Step 8)
3. Create the owner account with a strong password
4. Log in and configure site settings at `/admin/settings` (default visibility, theme)
5. Web setup is now permanently disabled — future owner changes use the CLI

> If you lose the owner password, reset it via CLI:
> ```sh
> docker compose exec app node scripts/reset-password.ts --username owner
> ```

---

## Step 12 — Prevent instance reclamation

Oracle may reclaim Always Free instances that sit idle for an extended period. Add a
lightweight cron heartbeat to signal activity:

```sh
(crontab -l 2>/dev/null; echo "*/10 * * * * /usr/bin/true") | crontab -
```

The Docker healthcheck (every 30s) also generates some CPU activity, but the cron job is a
cheap extra safeguard.

---

## Step 13 — Back up your data

The Docker named volume `marcia_recipe_data` holds all accounts, recipes, media, and personal
data. Back it up regularly and keep a copy off the host.

### Option A — App CLI backup (recommended)

```sh
docker compose exec app node scripts/backup.ts --data-root /data/marcia-recipe
```

This takes the `backup` lock for a consistent snapshot and writes a versioned `.tar.gz` inside
the volume. Copy it off the host:

```sh
docker cp $(docker compose ps -q app):/data/marcia-recipe/backups ./backups
scp -r -i ~/.ssh/oracle_key ./backups user@your-local-machine:~/marcia-backups/
```

### Option B — Volume-level backup

```sh
docker run --rm -v marcia_recipe_data:/data -v $(pwd):/backup alpine \
  tar czf /backup/marcia-recipe-data-$(date +%Y%m%d).tar.gz -C /data .
```

Then `scp` the archive off the host.

### Restore

```sh
# Dry-run first (validates without writing)
docker compose exec app node scripts/restore.ts --file backups/marcia-backup-...tar.gz --dry-run

# Force restore (replaces live data — requires --force)
docker compose exec app node scripts/restore.ts --file backups/marcia-backup-...tar.gz --force
```

Always back up before restore or migration.

---

## Step 14 — Keep the OS updated

```sh
sudo apt update && sudo apt upgrade -y
```

Reboot after kernel updates (the Docker volume persists):

```sh
sudo reboot
# Docker starts automatically on boot via systemd
```

To preserve your public IP across stop/start cycles, convert it to a **reserved IP**:
Console → **Networking** → **IP Management** → **Public IPs** → reserve, or on the instance's
VNIC page, convert the ephemeral IP to reserved.

---

## Troubleshooting

### "Out of host capacity" when creating the A1 instance

This is the most common Always Free pain point — Oracle over-subscribes A1 capacity. Workarounds:

1. **Try a different Availability Domain** within your region
2. **Try a different region** (capacity varies; US Midwest / Ashburn tend to be better)
3. **Try at off-peak hours** (early morning UTC / late night US time)
4. **Try a smaller shape** (1 OCPU / 6 GB) and resize later
5. **Retry periodically** — capacity is dynamic; people report success after hours/days
6. **Create an AMD micro first** to verify the account works, then retry A1

### Ports 80/443 reachable from outside but Caddy can't get a certificate

- Confirm DNS resolves to the correct IP: `dig +short recipes.yourdomain.com`
- Confirm both firewall layers (OCI Security List **and** OS firewall) allow 80/443
- Check Caddy logs: `sudo journalctl -u caddy --no-pager -n 50`

### Container is running but `/setup` returns an error

- Check the app logs: `docker compose logs -f app`
- Confirm `.env` has valid `AUTH_SECRET` (≥32 chars) and `SETUP_TOKEN` (≥8 chars)
- Confirm `APP_ORIGIN` matches your actual domain (including `https://`)

### App is slow or OOM-killed

You are likely on the AMD micro (1 GB RAM). Switch to the A1 Flex shape. If you must use micro,
add swap (not recommended for production):

```sh
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### Region lock-in

The home region selected at signup **cannot be changed**. Always Free resources are only
available in the home region. Choose carefully at signup.

---

## Quick reference — full sequence

```sh
# === OCI Console ===
# 1. Create account at https://cloud.oracle.com/free (pick region carefully)
# 2. Create A1 Flex instance (Ubuntu 24.04 ARM, 2 OCPU / 12 GB)
# 3. Add Security List ingress: 22, 80, 443 from 0.0.0.0/0
# 4. Note public IP

# === SSH in ===
ssh -i ~/.ssh/oracle_key ubuntu@<IP>

# System + firewall
sudo apt update && sudo apt upgrade -y
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw --force enable

# Docker
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER && newgrp docker
sudo systemctl enable --now docker

# Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

# App (from local machine)
rsync -avz --exclude node_modules --exclude .next --exclude .git \
  --exclude data --exclude data.locks --exclude local \
  -e "ssh -i ~/.ssh/oracle_key" ./* ubuntu@<IP>:/home/ubuntu/marcia-recipe/

# Back on instance
cd ~/marcia-recipe
# Create .env (see Step 8)
docker compose build && docker compose up -d

# Caddyfile
sudo tee /etc/caddy/Caddyfile <<EOF
recipes.yourdomain.com {
    reverse_proxy 127.0.0.1:3000
}
EOF
sudo systemctl reload caddy

# Anti-reclamation heartbeat
(crontab -l 2>/dev/null; echo "*/10 * * * * /usr/bin/true") | crontab -
```

---

## References

- [Oracle Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [Docker install on Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
- [Caddy install](https://caddyserver.com/docs/install)
- [Caddy reverse_proxy directive](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)