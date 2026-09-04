/**
 * sync-books.js
 * Scans the books/ directory, builds books.json, and auto-extracts EPUB covers.
 * Files ending with _OB (Open-Book / alternate versions) are excluded from the main listing.
 *
 * Usage: node scripts/sync-books.js
 * Requires: npm install adm-zip --save-dev
 */

const fs   = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const booksDir = path.join(root, 'books');
const coversDir = path.join(root, 'covers');
const output = path.join(root, 'books.json');

const ALLOWED_EXTENSIONS = ['.epub', '.pdf', '.mobi', '.azw3'];

// Ensure covers directory exists
if (!fs.existsSync(coversDir)) {
  fs.mkdirSync(coversDir, { recursive: true });
}

function slugify(name) {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function titleCase(name) {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── EPUB Cover Extraction ──────────────────────────────────────────
let AdmZip;
try {
  AdmZip = require('adm-zip');
} catch (e) {
  console.warn('adm-zip not found. Covers will not be extracted. Run: npm install adm-zip --save-dev');
}

function findCoverInOPF(zip) {
  try {
    const containerEntry = zip.getEntry('META-INF/container.xml');
    if (!containerEntry) return null;
    const containerXml = containerEntry.getData().toString('utf8');
    const opfMatch = containerXml.match(/full-path="([^"]+\.opf)"/i);
    if (!opfMatch) return null;
    const opfPath = opfMatch[1];
    const opfEntry = zip.getEntry(opfPath);
    if (!opfEntry) return null;
    const opfXml = opfEntry.getData().toString('utf8');
    const opfDir = path.dirname(opfPath);
    let imgPath = null;
    const ep3match = opfXml.match(/<item[^>]+properties="cover-image"[^>]+href="([^"]+)"/i)
      || opfXml.match(/<item[^>]+href="([^"]+)"[^>]+properties="cover-image"/i);
    if (ep3match) imgPath = ep3match[1];
    if (!imgPath) {
      const metaMatch = opfXml.match(/<meta\s+name="cover"\s+content="([^"]+)"/i);
      if (metaMatch) {
        const coverId = metaMatch[1];
        const itemMatch = opfXml.match(new RegExp(`<item[^>]+id="${coverId}"[^>]+href="([^"]+)"`, 'i'));
        if (itemMatch) imgPath = itemMatch[1];
      }
    }
    if (!imgPath) {
      const fallback = opfXml.match(/<item[^>]*id="[^"]*cover[^"]*"[^>]*href="([^"]+\.(jpg|jpeg|png|webp))"/i)
        || opfXml.match(/<item[^>]*href="([^"]*cover[^"]*\.(jpg|jpeg|png|webp))"/i);
      if (fallback) imgPath = fallback[1];
    }
    if (!imgPath) return null;
    const fullPath = opfDir && opfDir !== '.' ? `${opfDir}/${imgPath}` : imgPath;
    return fullPath.replace(/\\/g, '/');
  } catch (e) {
    return null;
  }
}

function extractCoverFromEpub(epubPath, slug) {
  if (!AdmZip) return null;
  try {
    const zip = new AdmZip(epubPath);
    const coverInternalPath = findCoverInOPF(zip);
    if (!coverInternalPath) {
      const entries = zip.getEntries();
      const coverEntry = entries.find(e => /cover\.(jpg|jpeg|png|webp)/i.test(e.entryName));
      if (!coverEntry) { console.warn(`  ⚠ No cover: ${path.basename(epubPath)}`); return null; }
      const ext = path.extname(coverEntry.entryName).toLowerCase();
      const outFile = path.join(coversDir, `${slug}${ext}`);
      fs.writeFileSync(outFile, coverEntry.getData());
      return `covers/${slug}${ext}`;
    }
    const coverEntry = zip.getEntry(coverInternalPath);
    if (!coverEntry) return null;
    const ext = path.extname(coverInternalPath).toLowerCase() || '.jpg';
    const outFile = path.join(coversDir, `${slug}${ext}`);
    fs.writeFileSync(outFile, coverEntry.getData());
    return `covers/${slug}${ext}`;
  } catch (e) {
    console.error(`  ✗ ${e.message}`);
    return null;
  }
}

// ── PDF Cover Extraction (Ghostscript → ImageMagick fallback) ──────────
function commandExists(cmd) {
  try { execSync(`which ${cmd}`, { stdio: 'ignore' }); return true; } catch { return false; }
}
function isPopplerPdftoppm() {
  try { return execSync('pdftoppm -h 2>&1 || true').toString().includes('-jpeg'); } catch { return false; }
}
const HAS_PDFTOPPM_POPPLER = commandExists('pdftoppm') && isPopplerPdftoppm();
const HAS_GS               = commandExists('gs');
const HAS_CONVERT          = commandExists('convert');

function extractCoverFromPdf(pdfPath, slug) {
  const outJpg = path.join(coversDir, `${slug}.jpg`);
  if (HAS_PDFTOPPM_POPPLER) {
    try {
      const prefix = path.join(coversDir, slug);
      execFileSync('pdftoppm', ['-jpeg', '-r', '150', '-f', '1', '-l', '1', pdfPath, prefix], { stdio: 'pipe' });
      const candidates = [
        `${prefix}-1.jpg`, `${prefix}-01.jpg`, `${prefix}-001.jpg`,
        `${prefix}-0001.jpg`, `${prefix}-00001.jpg`, `${prefix}-000001.jpg`,
      ];
      const generated = candidates.find(f => fs.existsSync(f));
      if (generated) { fs.renameSync(generated, outJpg); return `covers/${slug}.jpg`; }
    } catch {}
  }
  if (HAS_GS) {
    try {
      execFileSync('gs', [
        '-dNOPAUSE', '-dBATCH', '-dSAFER', '-sDEVICE=jpeg', '-dJPEGQ=92',
        '-r150', '-dFirstPage=1', '-dLastPage=1',
        `-sOutputFile=${outJpg}`, pdfPath
      ], { stdio: 'pipe' });
      if (fs.existsSync(outJpg) && fs.statSync(outJpg).size > 500) return `covers/${slug}.jpg`;
    } catch {}
  }
  if (HAS_CONVERT) {
    try {
      execFileSync('convert', ['-density', '150', '-quality', '92', `${pdfPath}[0]`, outJpg], { stdio: 'pipe' });
      if (fs.existsSync(outJpg) && fs.statSync(outJpg).size > 500) return `covers/${slug}.jpg`;
    } catch {}
  }
  return null;
}

// ── Main Sync Logic ────────────────────────────────────────────────
if (!fs.existsSync(booksDir)) {
  fs.mkdirSync(booksDir, { recursive: true });
}

const files = fs.readdirSync(booksDir, { withFileTypes: true })
  .filter(entry => {
    if (!entry.isFile()) return false;
    if (!ALLOWED_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) return false;
    // Skip alternate "_OB" (Open-Book) versions from main listing
    const base = path.basename(entry.name, path.extname(entry.name));
    if (base.endsWith('_OB') || base.endsWith('-OB')) return false;
    return true;
  })
  .map(entry => entry.name)
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

const books = files.map((file, index) => {
  const ext = path.extname(file).toLowerCase().replace('.', '');
  const slug = slugify(file);
  const bookPath = path.join(booksDir, file);
  
  // Extract cover based on format
  let cover = null;
  if (ext === 'epub') {
    // Check if cover already extracted
    const existingCovers = fs.existsSync(coversDir)
      ? fs.readdirSync(coversDir).filter(f => path.basename(f, path.extname(f)) === slug)
      : [];
    if (existingCovers.length > 0) {
      cover = `covers/${existingCovers[0]}`;
    } else {
      cover = extractCoverFromEpub(bookPath, slug);
    }
  } else if (ext === 'pdf') {
    // Check if cover already extracted
    const pdfCover = path.join(coversDir, `${slug}.jpg`);
    if (fs.existsSync(pdfCover)) {
      cover = `covers/${slug}.jpg`;
    } else {
      cover = extractCoverFromPdf(bookPath, slug);
    }
  }

  const entry = {
    title: titleCase(file),
    slug,
    file: `books/${file}`,
    format: ext ? ext.toUpperCase() : 'EPUB',
    status: 'published',
    order: index + 1
  };
  if (cover) entry.cover = cover;
  return entry;
});

const data = {
  generatedAt: new Date().toISOString(),
  books
};

fs.writeFileSync(output, JSON.stringify(data, null, 2) + '\n');
console.log(`✅ Synced ${books.length} book(s) to books.json`);
