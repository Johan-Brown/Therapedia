const state = {
  category: null,
  books: [],
  query: '',
  sortBy: 'featured'
};

const $ = (selector) => document.querySelector(selector);

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function titleInitials(title) {
  const words = String(title).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '🩺';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

async function loadJson(file) {
  const response = await fetch(`${file}?t=${Date.now()}`, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Could not load ${file} (${response.status})`);
  return response.json();
}

function renderCategory() {
  const category = state.category || {};
  const title = category.title || 'Therapedia';
  document.title = `${title} — Digital Library`;
  $('#categoryTitle').textContent = title;
  $('#categoryDescription').textContent = category.description || 'Mental wellness manuals, psychosocial dictionaries, and therapeutic guidance.';
  $('#categoryBadge').textContent = category.badge || 'WELLNESS & THERAPY';
}

function renderBooks() {
  const grid = $('#booksGrid');
  const query = state.query.trim().toLowerCase();
  
  let books = state.books
    .filter(book => book.status !== 'draft' && book.status !== 'hidden')
    .filter(book => !query || String(book.title).toLowerCase().includes(query));

  // Sorting Logic
  if (state.sortBy === 'az') {
    books.sort((a, b) => String(a.title).localeCompare(String(b.title)));
  } else if (state.sortBy === 'za') {
    books.sort((a, b) => String(b.title).localeCompare(String(a.title)));
  } else if (state.sortBy === 'recent') {
    books.sort((a, b) => (Number(b.order) || 0) - (Number(a.order) || 0));
  } else if (state.sortBy === 'oldest') {
    books.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  } else {
    // Featured default
    books.sort((a, b) => (Number(a.order) || 999999) - (Number(b.order) || 999999));
  }

  $('#bookCount').textContent = query
    ? `${books.length} matching book${books.length === 1 ? '' : 's'}`
    : `${books.length} book${books.length === 1 ? '' : 's'} in this collection`;

  if (!books.length) {
    grid.innerHTML = `<div class="empty">No books found${query ? ` for “${escapeHtml(state.query)}”` : ''}.</div>`;
    return;
  }

  grid.innerHTML = books.map((book, index) => {
    const title = escapeHtml(book.title || 'Untitled Book');
    const file = book.file || '';
    const format = escapeHtml((book.format || 'EPUB').toUpperCase());
    const href = `reader.html?book=${encodeURIComponent(file)}`;
    const initials = escapeHtml(titleInitials(book.title));
    
    return `
      <article class="book-card">
        <div class="book-cover">
          <div class="cover-top-bar">
            <span class="cover-order">BOOK ${Number(book.order) || index + 1}</span>
            <span class="cover-badge">${format}</span>
          </div>
          <div class="cover-center">
            <h4 class="cover-title-preview">${title}</h4>
            <div class="cover-symbol" aria-hidden="true">${initials}</div>
          </div>
        </div>
        <div class="book-body">
          <h3 class="book-title">${title}</h3>
          <p class="book-format">${format} Storybook</p>
          <a class="read-btn" href="${href}">Read Book <span aria-hidden="true">→</span></a>
        </div>
      </article>`;
  }).join('');
}

function showError(error) {
  console.error(error);
  $('#status').textContent = 'The library could not be loaded. Please check that category.json and books.json exist.';
}

async function init() {
  $('#year').textContent = new Date().getFullYear();
  
  $('#searchInput').addEventListener('input', (event) => {
    state.query = event.target.value;
    renderBooks();
  });

  const sortSelect = $('#sortSelect');
  if (sortSelect) {
    sortSelect.addEventListener('change', (event) => {
      state.sortBy = event.target.value;
      renderBooks();
    });
  }

  try {
    const [category, booksData] = await Promise.all([
      loadJson('./category.json'),
      loadJson('./books.json')
    ]);
    state.category = category;
    state.books = Array.isArray(booksData) ? booksData : (booksData.books || []);
    renderCategory();
    renderBooks();
    $('#status').classList.add('hidden');
  } catch (error) {
    showError(error);
  }
}

document.addEventListener('DOMContentLoaded', init);
