import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://sofa.local',
  output: 'static',
  vite: {
    resolve: {
      alias: { '@': new URL('./src', import.meta.url).pathname }
    }
  }
});
