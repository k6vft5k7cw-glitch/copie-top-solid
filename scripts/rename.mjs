// Après le build « single » :
//  - release/FormaCAD.html (U+FFFD échappé) + release/FormaCAD.zip
//  - docs/app.html + docs/FormaCAD.zip pour le site de téléchargement (GitHub Pages, dossier /docs)
import fs from 'fs';
import { zipSync, strToU8 } from 'three/examples/jsm/libs/fflate.module.js';
const src = 'release/index.html', dst = 'release/FormaCAD.html';
if (fs.existsSync(src)) {
  const html = fs.readFileSync(src, 'utf8').replaceAll('�', '\\uFFFD');
  fs.writeFileSync(dst, html);
  fs.unlinkSync(src);
  const files = { 'FormaCAD/FormaCAD.html': strToU8(html), 'FormaCAD/LISEZ-MOI.txt': strToU8('FormaCAD\r\n\r\nDouble-cliquez sur FormaCAD.html pour lancer le logiciel dans votre navigateur (Chrome, Edge ou Firefox).\r\nAucune installation n\'est nécessaire et tout fonctionne sans internet (sauf l\'assistant IA, qui demande une clé API Anthropic).\r\n\r\nLicences des composants tiers : dossier licences.\r\n') };
  for (const f of fs.readdirSync('release')) if (f.startsWith('LICENSE')) files['FormaCAD/licences/' + f] = new Uint8Array(fs.readFileSync('release/' + f));
  const zip = zipSync(files, { level: 9 });
  fs.writeFileSync('release/FormaCAD.zip', zip);
  fs.mkdirSync('docs', { recursive: true });
  fs.writeFileSync('docs/app.html', html);
  fs.writeFileSync('docs/FormaCAD.zip', zip);
  console.log(`✔ ${dst} (${(fs.statSync(dst).size / 1e6).toFixed(1)} Mo), release/FormaCAD.zip (${(zip.length / 1e6).toFixed(1)} Mo), docs/ prêt pour GitHub Pages.`);
}
