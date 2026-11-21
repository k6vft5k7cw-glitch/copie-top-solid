// Renomme release/index.html en release/FormaCAD.html
// et échappe le caractère U+FFFD (présent dans une chaîne JS d'une dépendance) en �.
import fs from 'fs';
const src = 'release/index.html', dst = 'release/FormaCAD.html';
if (fs.existsSync(src)) {
  const html = fs.readFileSync(src, 'utf8').replaceAll('�', '\\uFFFD');
  fs.writeFileSync(dst, html);
  fs.unlinkSync(src);
  console.log(`✔ ${dst} (${(fs.statSync(dst).size / 1e6).toFixed(1)} Mo) – ouvrez-le avec votre navigateur, aucune installation requise.`);
}
