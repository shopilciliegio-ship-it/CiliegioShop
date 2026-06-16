// Genera ciliegio_maskable.png: sfondo nero 512x512, logo centrato nella safe zone (80%)
// Usage: node scripts/make-icons.js

const sharp = require('sharp');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC  = path.join(ROOT, 'ciliegio_trasparente.png');

async function make(size) {
  const safeZone = Math.round(size * 0.72); // un po' meno dell'80% per avere margine visivo

  // Ridimensiona il logo per stare nella safe zone mantenendo l'aspect ratio
  const logo = await sharp(SRC)
    .resize(safeZone, safeZone, { fit: 'inside', withoutEnlargement: false })
    .toBuffer();

  const meta = await sharp(logo).metadata();
  const left = Math.round((size - meta.width) / 2);
  const top  = Math.round((size - meta.height) / 2);

  await sharp({
    create: { width: size, height: size, channels: 4,
               background: { r: 0, g: 0, b: 0, alpha: 1 } }
  })
  .composite([{ input: logo, left, top }])
  .png()
  .toFile(path.join(ROOT, `ciliegio_maskable_${size}.png`));

  console.log(`✓ ciliegio_maskable_${size}.png  (logo ${meta.width}×${meta.height} centrato su ${size}×${size})`);
}

(async () => {
  await make(192);
  await make(512);
  console.log('Done.');
})();
