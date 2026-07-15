import { defineConfig } from '@flue/cli/config';

export default defineConfig({
  // Build for the Cloudflare platform: agents and workflows run inside
  // Durable Objects; conversation streams and workflow run history live in
  // Durable Object SQLite automatically (no db.ts on this target).
  target: 'cloudflare',
});
