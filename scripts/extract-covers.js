/**
 * extract-covers.js
 * ─────────────────────────────────────────────────────────────
 * Extracts / renders the cover image for every book in books/
 * and saves it to covers/<slug>.<ext>, then updates books.json.
 *
 *  • EPUB  → unzipped via adm-zip, cover image pulled from OPF manifest
 *  • PDF   → page 1 rendered to JPEG via pdftoppm (Poppler, system tool)
 *            fallback: Ghostscript  |  fallback: ImageMagick convert
 *
 * Usage:
 *   node scripts/extract-covers.js
 *
 * Prerequisites:
 *   npm install adm-zip --save-dev     (for EPUB)
 *   sudo apt install poppler-utils     (for PDF — pdftoppm)
 *     OR: sudo apt install ghostscript
 *     OR: sudo apt install imagemagick
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

const root         = path.resolve(__dirname, '..');
const booksDir     = path.join(root, 'books');
const coversDir    = path.join(root, 'covers');
const booksJsonPath = path.join(root, 'books.json');

// ── Ensure covers/ directory exists ───────────────────────────
if (!fs.existsSync(coversDir)) fs.mkdirSync(coversDir, { recursive: true });

// ── Detect available PDF tools ────────────────────────────────
function commandExists(cmd) {
  try { execSync(`which ${cmd}`, { stdio: 'ignore' }); return true; } catch { return false; }
}
// Detect if pdftoppm is Poppler build (supports -jpeg/-f/-l) vs xpdf build (does not)
function isPopplerPdftoppm() {
  try {
    const out = execSync('pdftoppm -h 2>&1 || true').toString();
    return out.includes('-jpeg') || out.includes('-png');
  } catch { return false; }
}
const HAS_PDFTOPPM_POPPLER = commandExists('pdftoppm') && isPopplerPdftoppm();
const HAS_GS               = commandExists('gs');
const HAS_CONVERT          = commandExists('convert');

console.log(`PDF tools: pdftoppm(poppler)=${HAS_PDFTOPPM_POPPLER} ghostscript=${HAS_GS} imagemagick=${HAS_CONVERT}\n`);

// ── Helpers ───────────────────────────────────────────────────
function slugify(name) {
  return name
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ══════════════════════════════════════════════════════════════
//  PDF COVER  — rendered from page 1
// ══════════════════════════════════════════════════════════════

/**
 * Render page 1 of a PDF to a JPEG using the best available tool.
 * Returns the saved cover path (relative to repo root) or null.
 */
function extractCoverFromPdf(pdfPath, slug) {
  const outJpg = path.join(coversDir, `${slug}.jpg`);

  // ── Strategy 1: pdftoppm (Poppler build only) ───────────────
  if (HAS_PDFTOPPM_POPPLER) {
    try {
      const prefix = path.join(coversDir, slug);
      execFileSync('pdftoppm', [
        '-jpeg', '-r', '150', '-f', '1', '-l', '1',
        pdfPath, prefix
      ], { stdio: 'pipe' });
      const candidates = [
        `${prefix}-1.jpg`, `${prefix}-01.jpg`, `${prefix}-001.jpg`,
        `${prefix}-0001.jpg`, `${prefix}-00001.jpg`, `${prefix}-000001.jpg`,
      ];
      const generated = candidates.find(f => fs.existsSync(f));
      if (generated) {
        fs.renameSync(generated, outJpg);
        console.log(`  ✓ PDF cover (pdftoppm): covers/${slug}.jpg`);
        return `covers/${slug}.jpg`;
      }
    } catch (e) {
      console.warn(`  ⚠ pdftoppm failed: ${e.message}`);
    }
  }

  // ── Strategy 2: Ghostscript ───────────────────────────────────
  if (HAS_GS) {
    try {
      execFileSync('gs', [
        '-dNOPAUSE', '-dBATCH', '-dSAFER',
        '-sDEVICE=jpeg',
        '-dJPEGQ=92',
        '-r150',
        '-dFirstPage=1', '-dLastPage=1',
        `-sOutputFile=${outJpg}`,
        pdfPath
      ], { stdio: 'pipe' });

      if (fs.existsSync(outJpg) && fs.statSync(outJpg).size > 500) {
        console.log(`  ✓ PDF cover (ghostscript): covers/${slug}.jpg`);
        return `covers/${slug}.jpg`;
      }
    } catch (e) {
      console.warn(`  ⚠ ghostscript failed: ${e.message}`);
    }
  }

  // ── Strategy 3: ImageMagick convert ──────────────────────────
  if (HAS_CONVERT) {
    try {
      // convert reads PDF[0] (page index 0 = page 1)
      execFileSync('convert', [
        '-density', '150',
        '-quality', '92',
        `${pdfPath}[0]`,
        outJpg
      ], { stdio: 'pipe' });

      if (fs.existsSync(outJpg) && fs.statSync(outJpg).size > 500) {
        console.log(`  ✓ PDF cover (imagemagick): covers/${slug}.jpg`);
        return `covers/${slug}.jpg`;
      }
    } catch (e) {
      console.warn(`  ⚠ imagemagick failed: ${e.message}`);
    }
  }

  console.error(`  ✗ Could not render PDF cover for: ${path.basename(pdfPath)}`);
  console.error('    Install poppler-utils:  sudo apt install poppler-utils');
  return null;
}

// ══════════════════════════════════════════════════════════════
//  EPUB COVER  — extracted from ZIP/OPF manifest
// ══════════════════════════════════════════════════════════════

let AdmZip;
try {
  AdmZip = require('adm-zip');
} catch {
  console.warn('adm-zip not installed. EPUB covers will be skipped. Run: npm install adm-zip --save-dev');
}

/** Parse OPF manifest to find the cover image's internal EPUB path. */
function findCoverInOPF(zip) {
  try {
    const containerEntry = zip.getEntry('META-INF/container.xml');
    if (!containerEntry) return null;
    const containerXml = containerEntry.getData().toString('utf8');
    const opfMatch = containerXml.match(/full-path="([^"]+\.opf)"/i);
    if (!opfMatch) return null;
    const opfPath  = opfMatch[1];
    const opfEntry = zip.getEntry(opfPath);
    if (!opfEntry) return null;
    const opfXml = opfEntry.getData().toString('utf8');
    const opfDir = path.dirname(opfPath);
    let imgPath  = null;

    // 1. Explicit id="cover" or id="cover-image" (Prioritized)
    const explicitMatch = opfXml.match(/<item[^>]+id=["'](?:cover|cover-image)["'][^>]+href=["']([^"']+)["']/i)
                       || opfXml.match(/<item[^>]+href=["']([^"']+)["'][^>]+id=["'](?:cover|cover-image)["']/i);
    if (explicitMatch) {
      imgPath = explicitMatch[1];
    }

    // 2. EPUB3 properties="cover-image"
    if (!imgPath) {
      const ep3match = opfXml.match(/<item[^>]+properties=["']cover-image["'][^>]+href=["']([^"']+)["']/i)
                    || opfXml.match(/<item[^>]+href=["']([^"']+)["'][^>]+properties=["']cover-image["']/i);
      if (ep3match) imgPath = ep3match[1];
    }

    // 3. EPUB2 <meta name="cover" content="COVER_ID"/>
    if (!imgPath) {
      const metaMatch = opfXml.match(/<meta\s+name=["']cover["']\s+content=["']([^"']+)["']/i);
      if (metaMatch) {
        const coverId = metaMatch[1];
        const itemMatch = opfXml.match(new RegExp(`<item[^>]+id=["']${coverId}["'][^>]+href=["']([^"']+)["']`, 'i'))
                       || opfXml.match(new RegExp(`<item[^>]+href=["']([^"']+)["'][^>]+id=["']${coverId}["']`, 'i'));
        if (itemMatch) imgPath = itemMatch[1];
      }
    }

    // 4. Safe fallback: any image item with "cover" but NOT "backcover"
    if (!imgPath) {
      const itemRegex = /<item[^>]+>/gi;
      let match;
      while ((match = itemRegex.exec(opfXml)) !== null) {
        const tag = match[0].toLowerCase();
        if (tag.includes('cover') && !tag.includes('backcover')) {
          const hrefMatch = match[0].match(/href=["']([^"']+\.(?:jpg|jpeg|png|webp))["']/i);
          if (hrefMatch) {
            imgPath = hrefMatch[1];
            break;
          }
        }
      }
    }

    if (!imgPath) return null;

    const full = (opfDir && opfDir !== '.') ? `${opfDir}/${imgPath}` : imgPath;
    return full.replace(/\\/g, '/');
  } catch { return null; }
}

function extractCoverFromEpub(epubPath, slug) {
  if (!AdmZip) return null;
  try {
    const zip = new AdmZip(epubPath);
    let coverPath = findCoverInOPF(zip);

    // Last resort: scan zip for any file named "cover.*" (excluding backcover)
    if (!coverPath) {
      const entry = zip.getEntries().find(e => {
        const name = e.entryName.toLowerCase();
        return name.includes('cover') && !name.includes('backcover') && /\.(jpg|jpeg|png|webp)$/.test(name);
      });
      if (!entry) { console.warn(`  ⚠ No cover found: ${path.basename(epubPath)}`); return null; }
      coverPath = entry.entryName;
    }

    const entry = zip.getEntry(coverPath);
    if (!entry) { console.warn(`  ⚠ Cover entry missing: ${coverPath}`); return null; }

    const ext    = path.extname(coverPath).toLowerCase() || '.jpg';
    const outFile = path.join(coversDir, `${slug}${ext}`);
    fs.writeFileSync(outFile, entry.getData());
    console.log(`  ✓ EPUB cover: covers/${slug}${ext}`);
    return `covers/${slug}${ext}`;
  } catch (e) {
    console.error(`  ✗ ${path.basename(epubPath)}: ${e.message}`);
    return null;
  }
}

// ══════════════════════════════════════════════════════════════
//  MAIN — process all books in books.json
// ══════════════════════════════════════════════════════════════

const booksData = JSON.parse(fs.readFileSync(booksJsonPath, 'utf8'));
const books     = Array.isArray(booksData) ? booksData : (booksData.books || []);

let updated = 0;

for (const book of books) {
  const bookPath = path.join(root, book.file);
  const ext      = path.extname(book.file).toLowerCase();

  // Skip if cover already exists and file is present on disk
  if (book.cover && fs.existsSync(path.join(root, book.cover))) {
    console.log(`  ↩ Already has cover: ${book.title}`);
    continue;
  }

  if (!fs.existsSync(bookPath)) {
    console.warn(`  ⚠ File not found: ${book.file}`);
    continue;
  }

  console.log(`Processing: ${book.title} [${ext.toUpperCase().slice(1)}]`);

  let coverRelPath = null;

  if (ext === '.epub') {
    coverRelPath = extractCoverFromEpub(bookPath, book.slug);
  } else if (ext === '.pdf') {
    coverRelPath = extractCoverFromPdf(bookPath, book.slug);
  } else {
    console.log(`  — Unsupported format, skipping: ${ext}`);
  }

  if (coverRelPath) {
    book.cover = coverRelPath;
    updated++;
  }
}

// Write back books.json
if (Array.isArray(booksData)) {
  fs.writeFileSync(booksJsonPath, JSON.stringify(books, null, 2) + '\n');
} else {
  booksData.books     = books;
  booksData.generatedAt = new Date().toISOString();
  fs.writeFileSync(booksJsonPath, JSON.stringify(booksData, null, 2) + '\n');
}

console.log(`\n✅ Done. Processed ${updated} new cover(s). books.json updated.`);
