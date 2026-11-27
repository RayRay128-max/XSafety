importScripts('rules.js', 'backup.js');

const OFFSCREEN = 'offscreen.html';
const LOCAL = chrome.storage.local;
let creating;
let mutations = Promise.resolve();
const imageCache = new Map();
let activeImages = 0;

async function ensureOffscreen() {
  if (creating) return creating;
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN)],
  });
  if (contexts.length) return;
  creating ??= chrome.offscreen.createDocument({
    url: OFFSCREEN,
    reasons: ['BLOBS'],
    justification: '投稿の画像を端末内でデコードし、センシティブかどうかを判定します。',
  }).finally(() => { creating = undefined; });
  return creating;
}

function inspectImage(source) {
  if (imageCache.has(source)) return imageCache.get(source);
  if (activeImages >= 2) return { retry: true };
  activeImages++;
  const job = (async () => {
    try {
      await ensureOffscreen();
      const result = await chrome.runtime.sendMessage({ target: 'classifier', source });
      if (!result?.scores) throw new Error('画像を判定できませんでした');
      return { sensitive: imageIsSensitive(result.scores) };
    } catch {
      imageCache.delete(source);
      return {};
    } finally {
      activeImages--;
    }
  })();
  imageCache.set(source, job);
  if (imageCache.size > 350) imageCache.delete(imageCache.keys().next().value);
  return job;
}

async function updateAccount(message) {
  const handle = handleOf(message.handle);
  if (!handle) return { ok: false };
  const key = 'account:' + handle;
  const state = await LOCAL.get({ [key]: null, enabled: true, images: true });
  const existing = state[key];
  if (message.type === 'detect') {
    if (!state.enabled || (message.reason === 'image' && !state.images) || existing ||
        !['tag', 'text', 'image', 'warning'].includes(message.reason)) return { ok: true };
  }
  const allowed = message.type === 'allow';
  if (message.type === 'add' && existing && !existing.allowed) return { ok: true };
  await LOCAL.set({
    [key]: { handle, allowed, reason: message.reason ?? 'manual', at: Date.now() },
  });
  return { ok: true };
}

async function importBackup(data) {
  const incoming = parseBackup(data);
  const stored = await LOCAL.get(null);
  const terms = [...new Set([...termsOf(stored.terms), ...incoming.keywords])];
  const updates = { terms: terms.join('\n') };
  let count = 0;
  for (const [handle, account] of incoming.accounts) {
    const key = 'account:' + handle;
    if (stored[key]) continue;
    updates[key] = account;
    count++;
  }
  await LOCAL.set(updates);
  return { ok: true, accounts: count, keywords: terms.length - new Set(termsOf(stored.terms)).size };
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  let fromX = false;
  try {
    const url = new URL(sender.url);
    fromX = url.protocol === 'https:' && SITE.test(url.hostname);
  } catch {}
  const fromPopup = sender.url === chrome.runtime.getURL('popup.html');
  if (fromX && message?.type === 'image') {
    const source = imageSource(message.source);
    if (!source) return;
    LOCAL.get({ enabled: true, images: true }).then(settings =>
      settings.enabled && settings.images ? inspectImage(source) : {}
    ).then(reply, () => reply({}));
    return true;
  }
  if ((fromX && message?.type === 'detect') ||
      (fromPopup && ['add', 'allow', 'import'].includes(message?.type))) {
    const job = mutations.then(() => message.type === 'import' ? importBackup(message.data) : updateAccount(message));
    mutations = job.catch(() => {});
    job.then(reply, error => reply({ ok: false, error: error.message }));
    return true;
  }
});
