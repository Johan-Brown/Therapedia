const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const root = path.resolve(__dirname, '..');
const booksDir = path.join(root, 'books');
const syncScript = path.join(__dirname, 'sync-books.js');

const ALLOWED_EXTENSIONS = ['.epub', '.pdf', '.mobi', '.azw3'];

let timer;
function sync() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    execFile(process.execPath, [syncScript], (error, stdout, stderr) => {
      if (error) console.error(error.message);
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stdout.write(stderr);
    });
  }, 300);
}

if (!fs.existsSync(booksDir)) {
  fs.mkdirSync(booksDir, { recursive: true });
}

console.log(`Watching ${booksDir} for book changes (EPUB/PDF)...`);
sync();
fs.watch(booksDir, { persistent: true }, (eventType, filename) => {
  if (filename && ALLOWED_EXTENSIONS.includes(path.extname(filename).toLowerCase())) {
    console.log(`${eventType}: ${filename}`);
    sync();
  }
});
