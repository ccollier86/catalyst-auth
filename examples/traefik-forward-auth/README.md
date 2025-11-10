# Traefik forward-auth demo

A docker-compose playground that demonstrates how to run Catalyst as a forward-auth provider behind
Traefik. The setup proxies a simple Next.js frontend and protects the `/admin` route with Catalyst.

## Files

- [`docker-compose.yml`](./docker-compose.yml) – starts Traefik, a Catalyst forward-auth sidecar, and a sample Next.js app.
- [`traefik.yaml`](./traefik.yaml) – configures the forward-auth middleware and routing rules.
- [`app/.env.example`](./app/.env.example) – template for the Catalyst credentials consumed by the demo frontend.

## Usage

```bash
pnpm install
# build the frontend example first to speed up bootstrapping
pnpm --filter @catalyst-auth/example-nextjs-forward-auth build

cd examples/traefik-forward-auth
docker compose up --build
```

Traefik exposes the public site on <http://localhost:8080> and the dashboard on <http://localhost:8081>.

The Next.js container reuses the same code as [`examples/nextjs-forward-auth`](../nextjs-forward-auth/) but
runs behind Traefik with the forward-auth middleware enabled.
