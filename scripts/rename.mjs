// Renomme release/index.html en release/FormaCAD.html
import fs from 'fs';
const src = 'release/index.html', dst = 'release/FormaCAD.html';
if (fs.existsSync(src)) {
  fs.renameSync(src, dst);
  console.log(`✔ ${dst} (${(fs.statSync(dst).size / 1e6).toFixed(1)} Mo) – ouvrez-le avec votre navigateur, aucune installation requise.`);
}
