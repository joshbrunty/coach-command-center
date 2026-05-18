# Coach Command Center

CTF Coaching Command Center, packaged for Docker-based production serving and
live development on Ubuntu 24.04.

## What Runs

- React/Vite frontend.
- Node/Express storage API.
- Postgres for shared durable state.
- Caddy serving the production build and proxying `/api`.

The app's existing `window.storage` calls are preserved through
`src/storage-client.js`, which talks to the storage API.

## Fresh Ubuntu 24.04 Setup

Install the host dependencies once:

```bash
sudo apt update
sudo apt install -y ca-certificates curl git ufw

sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
```

Log out and back in after adding your user to the `docker` group.

Recommended firewall:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## Configuration

Copy the example environment file and change the password before live use:

```bash
cp .env.example .env
```

For a public server with a real DNS name pointing at it, set:

```dotenv
APP_SITE_ADDRESS=coach.example.com
HTTP_PORT=80
HTTPS_PORT=443
POSTGRES_PASSWORD=replace-with-a-long-random-password
```

For local or LAN-only HTTP, keep:

```dotenv
APP_SITE_ADDRESS=:80
```

## Production-Style Run

Build and start the production profile:

```bash
docker compose --profile prod up -d --build
```

Watch logs:

```bash
docker compose --profile prod logs -f
```

Stop:

```bash
docker compose --profile prod down
```

Postgres data is kept in the `postgres_data` Docker volume.

## Live Development

Start the live development profile:

```bash
docker compose --profile dev up --build
```

Open:

- Frontend: `http://localhost:5173`
- API health: `http://localhost:3000/health`

The frontend container bind-mounts the repo and runs Vite with HMR. The API
container also bind-mounts the repo and runs Node's watch mode, so edits to
`server/index.js` restart the API automatically.

For remote live development, prefer an SSH tunnel, Tailscale, or a firewall
allowlist rather than exposing the dev ports to the public internet.

## Useful Commands

Rebuild production after a code change:

```bash
docker compose --profile prod up -d --build
```

Reset only containers, keeping database data:

```bash
docker compose --profile prod down
docker compose --profile prod up -d --build
```

Reset all app data:

```bash
docker compose down -v
```

Open a Postgres shell:

```bash
docker compose exec db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```
