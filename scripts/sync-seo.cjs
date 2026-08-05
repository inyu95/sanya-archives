const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const META_FILE = path.join(ROOT, "js", "content", "site-meta.js");
const INDEX_FILE = path.join(ROOT, "index.html");

function readExport(name) {
  const source = fs.readFileSync(META_FILE, "utf8");
  const pattern = new RegExp(
    `export const ${name}\\s*=\\s*"((?:\\\\.|[^"\\\\])*)";`,
    "s"
  );
  const match = source.match(pattern);
  if (!match) {
    throw new Error(`site-meta.js から ${name} を読み取れませんでした。`);
  }
  return match[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function readMultilineExport(name) {
  const source = fs.readFileSync(META_FILE, "utf8");
  const pattern = new RegExp(
    `export const ${name}\\s*=\\s*"((?:\\\\.|[^"\\\\])*)";\\s*\\nexport const`,
    "s"
  );
  const match = source.match(pattern);
  if (match) {
    return match[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return readExport(name);
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeJson(value) {
  return JSON.stringify(value).slice(1, -1);
}

function replaceMeta(html, attr, name, value) {
  const pattern = new RegExp(
    `<meta\\s+${attr}="${name}"\\s+content="[^"]*">`,
    "g"
  );
  if (!pattern.test(html)) {
    throw new Error(`index.html に ${name} の meta タグが見つかりません。`);
  }
  return html.replace(
    pattern,
    `<meta ${attr}="${name}" content="${escapeHtml(value)}">`
  );
}

function main() {
  const title = readExport("SITE_TITLE");
  const description = readMultilineExport("SITE_DESCRIPTION");
  const keywords = readMultilineExport("SITE_KEYWORDS");
  const ogDescription = readMultilineExport("SITE_OG_DESCRIPTION");
  const twitterDescription = readMultilineExport("SITE_TWITTER_DESCRIPTION");

  let html = fs.readFileSync(INDEX_FILE, "utf8");

  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);
  html = replaceMeta(html, "name", "description", description);
  html = replaceMeta(html, "name", "keywords", keywords);
  html = replaceMeta(html, "property", "og:title", title);
  html = replaceMeta(html, "property", "og:description", ogDescription);
  html = replaceMeta(html, "name", "twitter:title", title);
  html = replaceMeta(html, "name", "twitter:description", twitterDescription);

  const jsonLdPattern = /("description":\s*")[^"]*(")/;
  if (!jsonLdPattern.test(html)) {
    throw new Error("index.html の JSON-LD description が見つかりません。");
  }
  html = html.replace(jsonLdPattern, `$1${escapeJson(description)}$2`);

  fs.writeFileSync(INDEX_FILE, html, "utf8");
  console.log("index.html の SEO メタ情報を site-meta.js と同期しました。");
}

main();
