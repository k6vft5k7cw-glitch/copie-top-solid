import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `vite build`               -> dist/ (site web classique)
// `vite build --mode single` -> release/index.html : application complète en UN SEUL fichier,
//                               utilisable hors ligne par simple double-clic.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile({ removeViteModuleLoader: true })] : [],
  build: {
    outDir: mode === 'single' ? 'release' : 'dist',
    emptyOutDir: mode !== 'single', // conserve les licences dans release/
    chunkSizeWarningLimit: 20000,
    assetsInlineLimit: mode === 'single' ? 100_000_000 : 4096,
  },
  worker: { format: 'es' },
}));
