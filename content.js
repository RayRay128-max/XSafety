const POST = 'article[data-testid="tweet"], [role="article"][data-testid="tweet"], article[role="article"]';
const NAME = '[data-testid="User-Name"]';
const PHOTO = '[data-testid="tweetPhoto"] img, [data-testid="videoComponent"] img, [data-testid="videoComponent"] video[poster]';
const QUOTE = '[data-testid="quoteTweet"]';
const BODY = '[data-testid="tweetText"]';
const STATUS_PATH = /^\/([a-z0-9_]{1,15})\/status\/\d+\/?$/i;
const accounts = new Map();
const checked = new WeakMap();
const dirtyPosts = new Set();
const knownPosts = new Set();
const visiblePosts = new Set();
let stopped = false;
let revision = 0;
const visibility = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      visiblePosts.add(entry.target);
      dirtyPosts.add(entry.target);
    } else visiblePosts.delete(entry.target);
  }
  schedule();
}, { rootMargin: '100px' }) : null;

async function send(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    if (/context invalidated/i.test(String(error))) stop();
    return undefined;
  }
}

function stop() {
  stopped = true;
  observer.disconnect();
  visibility?.disconnect();
  clearTimeout(frame);
  document.querySelectorAll('.xsh-checking').forEach(node => node.classList.remove('xsh-checking'));
  dirtyPosts.clear();
  knownPosts.clear();
  visiblePosts.clear();
}

function track(post) {
  if (!knownPosts.has(post)) {
    knownPosts.add(post);
    if (visibility) visibility.observe(post);
    else visiblePosts.add(post);
  }
  dirtyPosts.add(post);
}

const pending = new Set();
const hidden = new Set();
const imageResults = new Map();
let settings;
let frame;
let inFlight = 0;

function headerOf(post) {
  return [...post.querySelectorAll(NAME)].find(node => node.closest(POST) === post && !node.closest(QUOTE));
}

function owned(post, node, header) {
  if (node.closest(POST) !== post || node.closest(QUOTE)) return false;
  for (let ancestor = node; ancestor !== post; ancestor = ancestor.parentElement) {
    if (ancestor.matches('[role="link"]') && !ancestor.contains(header) &&
        (ancestor.querySelector(NAME) || ancestor.querySelector('a[href*="/status/"] time'))) return false;
  }
  return true;
}

function authorOf(post, header) {
  const timestamp = [...post.querySelectorAll('a[href*="/status/"]')].find(anchor =>
    SITE.test(anchor.hostname) && STATUS_PATH.test(anchor.pathname) && owned(post, anchor, header) &&
    (header?.contains(anchor) || (anchor.querySelector('time') && !anchor.closest(BODY))));
  if (timestamp) return handleOf(STATUS_PATH.exec(timestamp.pathname)[1]);

  // Some layouts render the handle as plain text inside the author header.
  if (!header) return;
  const labels = new Set([...header.querySelectorAll('span, a')]
    .map(node => node.textContent.trim()).filter(text => text.startsWith('@')).map(handleOf).filter(Boolean));
  if (labels.size === 1) return labels.values().next().value;
  return handleOf(header.textContent.trim().startsWith('@') ? header.textContent : '');
}

function evidenceFor(post, header) {
  const bodies = [...post.querySelectorAll(BODY)].filter(node => owned(post, node, header));
  const body = bodies.map(node => node.textContent).join('\n');
  const tags = normalize(body).match(/#[\p{L}\p{M}\p{N}_]+/gu) ?? [];
  const warning = [...post.querySelectorAll('[data-testid="sensitiveMediaWarning"], [data-testid="contentWarning"], [role="button"], button')]
    .some(node => owned(post, node, header) && !node.closest(BODY) &&
      (node.matches('[data-testid="sensitiveMediaWarning"], [data-testid="contentWarning"]') ||
        WARNING.test((node.getAttribute('aria-label') || node.textContent).trim().slice(0, 180))));
  return reasonFor(body, tags, warning, settings.terms);
}

function applyHidden(post, shouldHide) {
  post.classList.toggle('xsh-hidden', shouldHide);
  if (shouldHide) hidden.add(post);
  else hidden.delete(post);
}

function register(post, handle, reason) {
  if (pending.has(handle)) return;
  pending.add(handle);
  send({ type: 'detect', handle, reason })
    .then(result => {
      if (!result?.ok) throw new Error('保存できませんでした');
    }).catch(() => {
      if (!stopped) setTimeout(() => { dirtyPosts.add(post); schedule(); }, 3000);
    }).finally(() => pending.delete(handle));
}

function inspectMedia(post, handle, media, source) {
  const cached = imageResults.get(source);
  media.classList.toggle('xsh-checking', cached === 'pending' || (cached === undefined));
  if (cached === true) register(post, handle, 'image');
  if (cached !== undefined || inFlight >= 1) return;
  inFlight++;
  imageResults.set(source, 'pending');
  send({ type: 'image', source }).then(result => {
    if (result?.retry) setTimeout(() => { imageResults.delete(source); visiblePosts.forEach(post => dirtyPosts.add(post)); schedule(); }, 1000);
    else imageResults.set(source, result?.sensitive === true);
  }).catch(() => imageResults.set(source, false)).finally(() => {
    inFlight--;
    if (imageResults.size > 400) {
      for (const [url, result] of imageResults) {
        if (result !== 'pending') imageResults.delete(url);
        if (imageResults.size <= 350) break;
      }
    }
    visiblePosts.forEach(post => dirtyPosts.add(post));
    schedule();
  });
}

function inspect(post) {
  const previous = checked.get(post);
  const metadata = previous?.revision === revision ? previous : {
    header: headerOf(post), revision,
  };
  const header = metadata.header;
  const handle = metadata.handle ?? authorOf(post, header);
  metadata.handle = handle;
  checked.set(post, metadata);
  const account = accounts.get(handle);
  const reason = settings.enabled && !account ? (metadata.reason ??= evidenceFor(post, header) || '') : undefined;
  applyHidden(post, Boolean(settings.enabled && (reason || (account && !account.allowed))));
  if (!settings.enabled || account || reason || !handle) {
    for (const node of post.querySelectorAll('.xsh-checking')) node.classList.remove('xsh-checking');
    if (reason && handle) register(post, handle, reason);
    return;
  }
  if (!settings.images || checked.get(post)?.handle !== handle) {
    for (const node of post.querySelectorAll('.xsh-checking')) node.classList.remove('xsh-checking');
  }
  if (!settings.images) return;
  if (!visiblePosts.has(post)) return;
  for (const node of post.querySelectorAll(PHOTO)) {
    if (!owned(post, node, header)) continue;
    const source = imageSource(node.poster || node.currentSrc || node.src);
    if (source) inspectMedia(post, handle, node, source);
    else node.classList.remove('xsh-checking');
  }
}

function scan() {
  frame = undefined;
  if (!settings || stopped) return;
  for (const post of knownPosts) {
    if (post.isConnected) continue;
    visibility?.unobserve(post);
    knownPosts.delete(post);
    visiblePosts.delete(post);
    hidden.delete(post);
    dirtyPosts.delete(post);
  }
  const deadline = performance.now() + 7;
  for (const post of dirtyPosts) {
    dirtyPosts.delete(post);
    if (post.isConnected) inspect(post);
    if (performance.now() >= deadline) break;
  }
  if (dirtyPosts.size) schedule();
}

function schedule() {
  if (!stopped && frame === undefined) frame = setTimeout(scan, 80);
}

function collect(node) {
  const element = node.nodeType === 1 ? node : node.parentElement;
  if (!element) return;
  const parent = element.closest(POST);
  if (parent) {
    checked.delete(parent);
    track(parent);
  }
  for (const post of element.querySelectorAll(POST)) track(post);
}

function ingest(key, value) {
  if (!key.startsWith('account:')) return;
  if (value) accounts.set(key.slice(8), value);
  else accounts.delete(key.slice(8));
}

const startupChanges = [];
function changesReceived(changes) {
  for (const [key, {newValue}] of Object.entries(changes)) {
    if (Object.hasOwn(SETTINGS, key)) settings[key] = newValue ?? SETTINGS[key];
    ingest(key, newValue);
  }
  revision++;
  knownPosts.forEach(post => dirtyPosts.add(post));
  schedule();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (settings) changesReceived(changes);
  else startupChanges.push(changes);
});
chrome.storage.local.get(null).then(data => {
  settings = { ...SETTINGS };
  for (const [key, value] of Object.entries(data)) {
    if (Object.hasOwn(SETTINGS, key)) settings[key] = value;
    ingest(key, value);
  }
  startupChanges.forEach(changesReceived);
  document.querySelectorAll(POST).forEach(track);
  schedule();
}).catch(() => stop());

const observer = new MutationObserver(records => {
  for (const record of records) {
    const parent = record.target.nodeType === 1 ? record.target : record.target.parentElement;
    const post = parent?.closest(POST);
    if (post) { checked.delete(post); track(post); }
    for (const node of record.addedNodes) collect(node);
  }
  schedule();
});
observer.observe(document, {
  subtree: true, childList: true, characterData: true, attributes: true,
  attributeFilter: ['href', 'src', 'srcset', 'poster', 'aria-label', 'data-testid', 'role'],
});
if (!visibility) addEventListener('scroll', () => {
  for (const post of knownPosts) {
    const rect = post.getBoundingClientRect();
    if (rect.bottom >= -100 && rect.top <= innerHeight + 100) {
      visiblePosts.add(post);
      dirtyPosts.add(post);
    } else visiblePosts.delete(post);
  }
  schedule();
}, { passive: true });
document.addEventListener('load', event => { collect(event.target); schedule(); }, true);
