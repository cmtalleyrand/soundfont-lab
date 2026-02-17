import { defineConfig } from 'vite';

export default defineConfig({
  base: '/soundfont-lab/',
  root: '.',
  build: {
    outDir: 'dist',
  },
  test: {
    globals: true,
  },
});
