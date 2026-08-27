const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const booksDir = path.join(root, 'books');
const output = path.join(root, 'books.json');

const ALLOWED_EXTENSIONS = ['.epub', '.pdf', '.mobi', '.azw3'];

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

if (!fs.existsSync(booksDir)) {
  fs.mkdirSync(booksDir, { recursive: true });
}

const files = fs.readdirSync(booksDir, { withFileTypes: true })
  .filter(entry => entry.isFile() && ALLOWED_EXTENSIONS.includes(path.extname(entry.name).toLowerCase()))
  .map(entry => entry.name)
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

const books = files.map((file, index) => {
  const ext = path.extname(file).toLowerCase().replace('.', '');
  return {
    title: titleCase(file),
    slug: slugify(file),
    file: `books/${file}`,
    format: ext ? ext.toUpperCase() : 'PDF',
    status: 'published',
    order: index + 1
  };
});

const data = {
  generatedAt: new Date().toISOString(),
  books
};

fs.writeFileSync(output, JSON.stringify(data, null, 2) + '\n');
console.log(`Synced ${books.length} book(s) to ${output}`);
