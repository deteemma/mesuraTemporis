import { lookup } from 'node:dns';
import { Agent } from 'node:https';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// En développement (pnpm dev:web), /api est relayé vers l'application qui
// tourne dans Docker, derrière Caddy : https://<APP_NAME>.localhost, APP_NAME
// étant lu dans le .env racine (ADR-0007). API_URL permet de viser une autre adresse.
// Node ne résout pas toujours les noms en .localhost (Windows) : ils sont
// dirigés ici vers la machine locale, comme le fait le navigateur.
const localhostAgent = new Agent({
  lookup: (hostname, options, callback) =>
    hostname.endsWith('.localhost') ? lookup('localhost', options, callback) : lookup(hostname, options, callback),
});

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, '..', ''), ...process.env };
  const apiTarget = env.API_URL ?? (env.APP_NAME ? `https://${env.APP_NAME}.localhost` : undefined);
  if (!apiTarget) throw new Error('APP_NAME absent du .env racine (ou API_URL non défini)');
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true, secure: false, agent: localhostAgent },
      },
    },
  };
});
