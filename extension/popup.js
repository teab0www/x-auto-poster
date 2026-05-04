// config.js must be loaded before this file (provides SUPABASE_URL / SUPABASE_ANON_KEY globals)

let cfg = { url: SUPABASE_URL, key: SUPABASE_ANON_KEY };

// ---------------------------------------------------------------------------
// Config persistence
// ---------------------------------------------------------------------------

function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['supabaseUrl', 'supabaseAnonKey'], (result) => {
      if (result.supabaseUrl) cfg.url = result.supabaseUrl;
      if (result.supabaseAnonKey) cfg.key = result.supabaseAnonKey;
      document.getElementById('supabaseUrl').value = cfg.url;
      document.getElementById('supabaseAnonKey').value = cfg.key;
      resolve();
    });
  });
}

document.getElementById('saveConfig').addEventListener('click', () => {
  const url = document.getElementById('supabaseUrl').value.trim();
  const key = document.getElementById('supabaseAnonKey').value.trim();
  chrome.storage.local.set({ supabaseUrl: url, supabaseAnonKey: key }, () => {
    cfg = { url, key };
    const msg = document.getElementById('saveMsg');
    msg.textContent = 'Saved!';
    setTimeout(() => { msg.textContent = ''; }, 2000);
    loadPosts();
  });
});

// ---------------------------------------------------------------------------
// Fetch posts
// ---------------------------------------------------------------------------

async function fetchTodayPosts() {
  const now = new Date();
  // Show everything from today (midnight local) through end of tomorrow
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2).toISOString();

  const url =
    `${cfg.url}/rest/v1/posts` +
    `?scheduled_at=gte.${todayStart}` +
    `&scheduled_at=lte.${tomorrowEnd}` +
    `&order=scheduled_at.asc`;

  const res = await fetch(url, {
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function fmt(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderPosts(posts) {
  const container = document.getElementById('posts');
  const statusLine = document.getElementById('statusLine');

  if (!posts.length) {
    statusLine.textContent = 'No posts in the next 48 h';
    container.innerHTML = '<div class="empty">Nothing scheduled yet</div>';
    return;
  }

  statusLine.textContent = `${posts.length} post(s)`;
  container.innerHTML = posts
    .map((post) => {
      const preview = escapeHtml(
        post.content.length > 120 ? post.content.slice(0, 120) + '…' : post.content
      );
      const postedPart = post.posted_at
        ? ` &rarr; posted ${fmt(post.posted_at)}`
        : '';
      const errorPart = post.error
        ? `<div class="post-error">&#9888; ${escapeHtml(post.error)}</div>`
        : '';
      const postBtn = post.status === 'pending'
        ? `<button class="post-btn" data-id="${post.id}">Post now</button>`
        : '';
      return `
        <div class="post">
          <div class="post-meta">
            <span class="badge ${post.status}">${post.status}</span>
            <span class="post-time">${fmt(post.scheduled_at)}${postedPart}</span>
          </div>
          <div class="post-content">${preview}</div>
          ${errorPart}
          ${postBtn}
        </div>`;
    })
    .join('');
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

async function loadPosts() {
  const statusLine = document.getElementById('statusLine');
  try {
    statusLine.textContent = 'Loading…';
    const posts = await fetchTodayPosts();
    renderPosts(posts);
  } catch (err) {
    statusLine.textContent = `Error: ${err.message}`;
    document.getElementById('posts').innerHTML = '';
  }
}

// ---------------------------------------------------------------------------
// Sync button
// ---------------------------------------------------------------------------

document.getElementById('syncBtn').addEventListener('click', async () => {
  const btn = document.getElementById('syncBtn');
  btn.disabled = true;
  btn.textContent = 'Syncing…';
  try {
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'syncPosts' }, resolve);
    });
    await loadPosts();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sync now';
  }
});

// ---------------------------------------------------------------------------
// Post now buttons (inject into the active x.com tab)
// ---------------------------------------------------------------------------

document.getElementById('posts').addEventListener('click', async (e) => {
  const btn = e.target.closest('.post-btn');
  if (!btn) return;

  const postId = btn.dataset.id;
  btn.disabled = true;
  btn.textContent = 'Posting…';

  chrome.runtime.sendMessage({ type: 'postNow', postId }, (response) => {
    if (response && response.error) {
      btn.textContent = response.error;
      btn.disabled = false;
    } else {
      btn.textContent = 'Injected — watch x.com';
      // Refresh the list after the content script has had time to finish
      setTimeout(loadPosts, 15_000);
    }
  });
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

(async () => {
  await loadConfig();
  await loadPosts();
})();
