import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Four packages, no plugins beyond React. Every layout algorithm, the player,
// the split pane and the keyboard handling are written by hand -- not out of
// purity, but because each is 40-150 lines and each is a thing an interviewer
// can ask about. FRONTEND.md 1.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', sourcemap: true },
  server: { port: 5173 },
});
