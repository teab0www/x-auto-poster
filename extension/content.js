(async () => {
  function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function waitForElement(selector, timeout = 10_000) {
    return new Promise((resolve) => {
      const start = Date.now();
      (function poll() {
        const el = document.querySelector(selector);
        if (el) return resolve(el);
        if (Date.now() - start >= timeout) return resolve(null);
        setTimeout(poll, 200);
      })();
    });
  }

  async function typeIntoEditor(element, text) {
    element.focus();
    element.click();
    await delay(500);
    document.execCommand('insertText', false, text);
    await delay(300);
  }

  // -------------------------------------------------------------------------
  // Fetch post data from background
  // -------------------------------------------------------------------------

  const postData = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'getPostForTab' }, (response) => {
      resolve(response || null);
    });
  });

  if (!postData) {
    chrome.runtime.sendMessage({ type: 'postResult', postId: null, success: false, error: 'No post data found for this tab' });
    return;
  }

  const { id: postId, content } = postData;

  // -------------------------------------------------------------------------
  // Main posting flow
  // We land on /compose/post so the modal is already open — no button click needed.
  // -------------------------------------------------------------------------

  try {
    // 1. Wait for the modal (React needs a moment to boot and render it)
    const modal = await waitForElement('[aria-modal="true"]', 20_000);
    if (!modal) throw new Error('Compose modal not found — are you logged in to X?');

    const editor = modal.querySelector('[data-testid="tweetTextarea_0"]');
    if (!editor) throw new Error('Tweet textarea not found inside modal');
    await delay(400);

    // 2. Type via execCommand (works in active/focused tab with DraftJS)
    await typeIntoEditor(editor, content);

    if (!editor.textContent.trim()) {
      throw new Error('Typing failed — textarea still empty after input attempt');
    }

    // 3. Human-like pause before submitting
    await delay(randomBetween(1_000, 3_000));

    // 4. Click Post
    const postBtn = modal.querySelector('[data-testid="tweetButton"]');
    if (!postBtn) throw new Error('Post button not found inside modal');
    postBtn.click();

    // 5. Success = toast appears OR URL leaves /compose
    const succeeded = await Promise.race([
      waitForElement('[data-testid="toast"]', 12_000).then((el) => !!el),
      new Promise((resolve) => {
        const start = Date.now();
        (function poll() {
          if (!window.location.pathname.includes('/compose')) return resolve(true);
          if (Date.now() - start > 12_000) return resolve(false);
          setTimeout(poll, 300);
        })();
      }),
    ]);

    chrome.runtime.sendMessage({
      type: 'postResult', postId, success: succeeded,
      error: succeeded ? null : 'timeout: no confirmation after 12 s',
    });
  } catch (err) {
    chrome.runtime.sendMessage({ type: 'postResult', postId, success: false, error: err.message });
  }
})();
