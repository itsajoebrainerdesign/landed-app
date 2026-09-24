// Builds the home-screen / install icons in public/icons from the app logo.
//   node scripts/generate-icons.mjs [source.png]
// Icons must be solid squares (iOS and Android round the corners
// themselves), so the logo's transparent corners are filled with white.
// The source is only 316px — for sharper icons, re-run this with a
// 1024px version of the logo.
import sharp from "sharp";

const source = process.argv[2] || "public/landed-icon.png";
const out = (name) => `public/icons/${name}`;

async function icon(size, file) {
  await sharp(source)
    .resize(size, size, { fit: "contain", background: "#FFFFFF" })
    .flatten({ background: "#FFFFFF" })
    .png()
    .toFile(out(file));
}

// "maskable" icons get cropped to a circle or squircle on Android, so the
// logo sits inside the middle 80% (the safe zone) on a white square.
async function maskable(size, file) {
  const inner = Math.round(size * 0.8);
  const logo = await sharp(source)
    .resize(inner, inner, { fit: "contain", background: "#FFFFFF" })
    .flatten({ background: "#FFFFFF" })
    .png()
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 3, background: "#FFFFFF" } })
    .composite([{ input: logo, gravity: "centre" }])
    .png()
    .toFile(out(file));
}

await icon(180, "apple-touch-icon.png");
await icon(192, "icon-192.png");
await icon(512, "icon-512.png");
await maskable(512, "icon-maskable-512.png");
await icon(32, "favicon-32.png");
console.log("Icons written to public/icons/");
