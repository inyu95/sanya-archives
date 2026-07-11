const fs = require("fs");
const path = require("path");

const PHOTOS_DIR = path.join(__dirname, "..", "assets", "photos");
const OUTPUT = path.join(PHOTOS_DIR, "index.json");
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|svg|bmp)$/i;

function scanPhotosDir() {
  const index = {};
  if (!fs.existsSync(PHOTOS_DIR)) return index;

  fs.readdirSync(PHOTOS_DIR, { withFileTypes: true }).forEach(function (entry) {
    if (!entry.isDirectory()) return;

    const files = fs.readdirSync(path.join(PHOTOS_DIR, entry.name))
      .filter(function (file) { return IMAGE_EXT.test(file); })
      .sort();

    if (files.length > 0) {
      index[entry.name] = files;
    }
  });

  return index;
}

const index = scanPhotosDir();
fs.writeFileSync(OUTPUT, JSON.stringify(index, null, 2) + "\n", "utf8");
console.log("Generated assets/photos/index.json (" + Object.keys(index).length + " folders)");
