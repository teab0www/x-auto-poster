importScripts('config.js');

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------

async function getSupabaseConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['supabaseUrl', 'supabaseAnonKey'], (result) => {
      resolve({
        url: result.supabaseUrl || SUPABASE_URL,
        key: result.supabaseAnonKey || SUPABASE_ANON_KEY,
      });
    });
  });
}

async function supabaseFetch(path, options = {}) {
  const cfg = await getSupabaseConfig();
  const headers = {
    apikey: cfg.key,
    Authorization: `Bearer ${cfg.key}`,
    'Content-Type': 'application/json',
    ...options.headers,
  };
  if (options.method === 'PATCH') headers['Prefer'] = 'return=minimal';

  const res = await fetch(`${cfg.url}/rest/v1${path}`, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function updatePostStatus(id, status, error = null) {
  const body = { status };
  if (status === 'success') body.posted_at = new Date().toISOString();
  if (error) body.error = error;

  const patch = () =>
    supabaseFetch(`/posts?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });

  try {
    await patch();
  } catch (err) {
    // Retry once after 5 s, then fall back to local storage
    await new Promise((r) => setTimeout(r, 5000));
    try {
      await patch();
    } catch (retryErr) {
      console.error('updatePostStatus: persisting to storage after double failure', retryErr);
      await chrome.storage.local.set({
        [`failed_update_${id}`]: { id, status, error, ts: Date.now() },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Sync logic
// ---------------------------------------------------------------------------

async function markMissedPosts() {
  const now = new Date().toISOString();
  try {
    const posts = await supabaseFetch(
      `/posts?status=eq.pending&scheduled_at=lt.${now}`
    );
    for (const post of posts) {
      await updatePostStatus(post.id, 'failed', 'missed: Chrome was not running at scheduled time');
    }
  } catch (err) {
    console.error('markMissedPosts failed:', err);
  }
}

async function syncPendingPosts() {
  await markMissedPosts();

  // Clear existing post-* alarms
  const alarms = await chrome.alarms.getAll();
  for (const alarm of alarms) {
    if (alarm.name.startsWith('post-')) await chrome.alarms.clear(alarm.name);
  }

  const now = new Date();
  const windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  try {
    const posts = await supabaseFetch(
      `/posts?status=eq.pending` +
        `&scheduled_at=gte.${now.toISOString()}` +
        `&scheduled_at=lte.${windowEnd.toISOString()}` +
        `&order=scheduled_at.asc`
    );

    // Group by exact scheduled_at so same-time posts get a 30 s stagger
    const groups = new Map();
    for (const post of posts) {
      const t = new Date(post.scheduled_at).getTime();
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t).push(post);
    }

    for (const [baseTime, group] of groups) {
      group.forEach((post, idx) => {
        const when = Math.max(baseTime + idx * 30_000, Date.now() + 5_000);
        chrome.alarms.create(`post-${post.id}`, { when });
      });
    }

    console.log(`[sync] scheduled ${posts.length} alarm(s)`);
  } catch (err) {
    console.error('syncPendingPosts failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Posting flow
// ---------------------------------------------------------------------------

async function handlePostAlarm(postId) {
  let post;
  try {
    const rows = await supabaseFetch(`/posts?id=eq.${postId}`);
    post = rows[0];
  } catch (err) {
    console.error('handlePostAlarm: fetch failed', err);
    return;
  }

  if (!post || post.status !== 'pending') return;

  // /compose/post opens with the modal already visible — no button click needed
  const tab = await chrome.tabs.create({ url: 'https://x.com/compose/post', active: true });

  // Store the post keyed by tab ID so content.js can retrieve it
  await chrome.storage.local.set({
    [`tab_${tab.id}`]: { id: post.id, content: post.content },
  });

  // Wait for the tab to finish loading
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab load timeout after 30 s'));
    }, 30_000);

    function listener(tabId, info) {
      if (tabId !== tab.id || info.status !== 'complete') return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }

    chrome.tabs.onUpdated.addListener(listener);
  }).catch(async (err) => {
    await updatePostStatus(post.id, 'failed', err.message);
    chrome.storage.local.remove(`tab_${tab.id}`);
    chrome.tabs.remove(tab.id).catch(() => {});
    throw err; // rethrow to abort injection below
  });

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content.js'],
  }).catch(async (err) => {
    await updatePostStatus(post.id, 'failed', `Script injection failed: ${err.message}`);
    chrome.storage.local.remove(`tab_${tab.id}`);
    chrome.tabs.remove(tab.id).catch(() => {});
  });
}

// ---------------------------------------------------------------------------
// Message listener (content.js <-> background)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Popup "Post now" button — inject into the user's active x.com tab
  if (message.type === 'postNow') {
    const { postId } = message;
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.url || !tab.url.includes('x.com')) {
        sendResponse({ error: 'Open x.com first (any x.com page)' });
        return;
      }
      try {
        const rows = await supabaseFetch(`/posts?id=eq.${postId}`);
        const post = rows[0];
        if (!post) { sendResponse({ error: 'Post not found in Supabase' }); return; }
        await chrome.storage.local.set({
          // keepTab: true = don't close this tab when done (it's the user's own tab)
          [`tab_${tab.id}`]: { id: post.id, content: post.content, keepTab: true },
        });
        // Navigate to compose/post first so the modal is already open when content.js runs
        await chrome.tabs.update(tab.id, { url: 'https://x.com/compose/post' });
        await new Promise((resolve) => {
          function listener(tabId, info) {
            if (tabId !== tab.id || info.status !== 'complete') return;
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
          chrome.tabs.onUpdated.addListener(listener);
        });
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    });
    return true; // async response
  }

  // Popup requesting a manual sync
  if (message.type === 'syncPosts') {
    syncPendingPosts().then(() => sendResponse({ ok: true }));
    return true;
  }

  // content.js asking for its post data (keyed by the injected tab's id)
  if (message.type === 'getPostForTab') {
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) { sendResponse(null); return; }
    chrome.storage.local.get(`tab_${tabId}`, (result) => {
      sendResponse(result[`tab_${tabId}`] || null);
    });
    return true; // async
  }

  // content.js reporting the result of a posting attempt
  if (message.type === 'postResult') {
    const tabId = sender.tab && sender.tab.id;
    const { postId, success, error } = message;

    if (success) {
      updatePostStatus(postId, 'success');
    } else {
      updatePostStatus(postId, 'failed', error || 'Unknown error');
    }

    if (tabId) {
      chrome.storage.local.get(`tab_${tabId}`, (result) => {
        const data = result[`tab_${tabId}`] || {};
        chrome.storage.local.remove(`tab_${tabId}`);
        // Only close tabs we opened ourselves; never close the user's own tab
        if (!data.keepTab) chrome.tabs.remove(tabId).catch(() => {});
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Alarm listener
// ---------------------------------------------------------------------------

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'daily-sync') {
    syncPendingPosts();
  } else if (alarm.name.startsWith('post-')) {
    const postId = alarm.name.slice(5); // remove 'post-'
    handlePostAlarm(postId);
  }
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  // Recurring midnight resync (1440 min = 24 h); first fire after 1 min
  chrome.alarms.create('daily-sync', { delayInMinutes: 1, periodInMinutes: 1440 });
  syncPendingPosts();
});

chrome.runtime.onStartup.addListener(() => {
  syncPendingPosts();
});
