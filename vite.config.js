import fs from 'fs';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Moteur OpenCascade (wasm) embarqué en texte base64 simple (pas d'URI « data: » binaire),
// pour que la page reste partageable publiquement sur claude.ai.
const occtWasm = {
  name: 'occt-wasm-b64',
  resolveId: (id) => (id === 'virtual:occt-wasm' ? '\0occt-wasm' : null),
  load(id) {
    if (id !== '\0occt-wasm') return null;
    const b64 = fs.readFileSync('node_modules/occt-import-js/dist/occt-import-js.wasm').toString('base64');
    return `export default ${JSON.stringify(b64)};`;
  },
};

// Retire des dépendances les petites images de test en formats non vérifiables (AVIF)
// et neutralise le préfixe « data:application/octet-stream » d'Emscripten (jamais utilisé ici).
const sanitize = {
  name: 'sanitize-data-uris',
  enforce: 'pre',
  transform(code, id) {
    if (!id.includes('node_modules')) return null;
    let c = code.replace(/(['"])data:image\/avif;base64,[A-Za-z0-9+/=]+\1/g, "''");
    c = c.replaceAll('"data:application/octet-stream;base64,"', '["data:application","octet-stream;base64,"].join("/")');
    return c === code ? null : { code: c, map: null };
  },
};

// `vite build`               -> dist/ (site web classique)
// `vite build --mode single` -> release/index.html : application complète en UN SEUL fichier,
//                               utilisable hors ligne par simple double-clic.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [occtWasm, sanitize, ...(mode === 'single' ? [viteSingleFile({ removeViteModuleLoader: true })] : [])],
  build: {
    outDir: mode === 'single' ? 'release' : 'dist',
    emptyOutDir: mode !== 'single', // conserve les licences dans release/
    chunkSizeWarningLimit: 20000,
    assetsInlineLimit: mode === 'single' ? 100_000_000 : 4096,
  },
  worker: { format: 'es' },
}));
