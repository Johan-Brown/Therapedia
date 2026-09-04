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
  if (!words.length) return '📖';
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
  const title = category.title || 'NIBBLES';
  document.title = `${title} — Digital Library`;
  $('#categoryTitle').textContent = title;
  $('#categoryDescription').textContent = category.description || 'Narrative Intervention Books for Behavioural, Learning, Emotional & Social Development.';
  $('#categoryBadge').textContent = category.badge || 'INTERVENTION';
}

/**
 * Builds the inner page-flip layers for the hover animation.
 * Shows 3 "page" layers that fan out on hover like flipping pages.
 */
function buildPageFlipLayers(coverUrl, title) {
  const initials = escapeHtml(titleInitials(title));
  // Page 2 and 3 show a gradient interior (like interior book pages)
  return `
    <div class="book-page page-3" aria-hidden="true">
      <div class="page-lines">
        <span></span><span></span><span></span><span></span><span></span>
        <span></span><span></span><span></span>
      </div>
      <div class="page-icon">${initials}</div>
    </div>
    <div class="book-page page-2" aria-hidden="true">
      <div class="page-lines">
        <span></span><span></span><span></span><span></span><span></span>
        <span></span>
      </div>
    </div>
    <div class="book-page page-1" aria-hidden="true">
      <div class="page-content-preview">
        <div class="page-story-lines">
          <div class="ps-line long"></div>
          <div class="ps-line medium"></div>
          <div class="ps-line long"></div>
          <div class="ps-line short"></div>
          <div class="ps-line long"></div>
          <div class="ps-line medium"></div>
        </div>
      </div>
    </div>`;
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
    books.sort((a, b) => (Number(a.order) || 999999) - (Number(b.order) || 999999));
  }

  $('#bookCount').textContent = query
    ? `${books.length} matching book${books.length === 1 ? '' : 's'}`
    : `${books.length} book${books.length === 1 ? '' : 's'} in this collection`;

  if (!books.length) {
    grid.innerHTML = `<div class="empty">No books found${query ? ` for "${escapeHtml(state.query)}"` : ''}.</div>`;
    return;
  }

  grid.innerHTML = books.map((book, index) => {
    const title = escapeHtml(book.title || 'Untitled Book');
    const file = book.file || '';
    const format = escapeHtml((book.format || 'EPUB').toUpperCase());
    const href = `reader.html?book=${encodeURIComponent(file)}`;
    const orderNum = Number(book.order) || index + 1;
    const coverSrc = book.cover ? escapeHtml(book.cover) : '';

    const coverInner = coverSrc
      ? `<img class="cover-img" src="${coverSrc}" alt="${title} cover" loading="lazy" onerror="this.parentElement.classList.add('cover-fallback')">`
      : '';

    const pageFlip = buildPageFlipLayers(coverSrc, book.title || '');

    return `
      <article class="book-card" data-slug="${escapeHtml(book.slug || '')}">
        <a class="book-cover-link" href="${escapeHtml(href)}" aria-label="Read ${title}">
          <div class="book-3d-wrapper">
            ${pageFlip}
            <div class="book-cover${coverSrc ? '' : ' cover-fallback'}">
              ${coverInner}
              <div class="cover-overlay">
                <div class="cover-top-bar">
                  <span class="cover-order">BOOK ${orderNum}</span>
                  <span class="cover-badge">${format}</span>
                </div>
              </div>
              <div class="cover-hover-cta" aria-hidden="true">
                <span class="cta-icon">📖</span>
                <span class="cta-text">Read Now</span>
              </div>
              <div class="cover-fallback-inner" aria-hidden="true">
                <div class="cover-top-bar">
                  <span class="cover-order">BOOK ${orderNum}</span>
                  <span class="cover-badge">${format}</span>
                </div>
                <div class="cover-center">
                  <h4 class="cover-title-preview">${title}</h4>
                  <div class="cover-symbol">${escapeHtml(titleInitials(book.title || ''))}</div>
                </div>
              </div>
            </div>
          </div>
          <div class="book-spine" aria-hidden="true"></div>
        </a>
        <div class="book-body">
          <h3 class="book-title">${title}</h3>
          <p class="book-format">${format} Storybook</p>
          <a class="read-btn" href="${escapeHtml(href)}">Read Book <span aria-hidden="true">→</span></a>
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
