const byId = id => document.getElementById(id);
const status = byId('status');

async function accountAction(type, handle) {
  try {
    const result = await chrome.runtime.sendMessage({ type, handle });
    if (!result?.ok) throw new Error('操作を保存できませんでした');
    status.textContent = type === 'allow' ? '@' + handle + ' を表示に戻しました。' : '@' + handle + ' を非表示にしました。';
    return true;
  } catch {
    status.textContent = '操作を保存できませんでした。';
    return false;
  }
}

function renderList(id, entries) {
  const list = byId(id);
  list.replaceChildren();
  if (!entries.length) {
    const line = document.createElement('li');
    line.textContent = '登録なし';
    list.append(line);
    return;
  }
  for (const item of entries) {
    const row = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = '@' + item.handle;
    if (!item.allowed) {
      const reason = document.createElement('small');
      reason.textContent = REASONS[item.reason] || '手動登録';
      label.append(reason);
    }
    const button = document.createElement('button');
    button.textContent = item.allowed ? '非表示に戻す' : '表示に戻す';
    button.addEventListener('click', async () => {
      button.disabled = true;
      if (!await accountAction(item.allowed ? 'add' : 'allow', item.handle)) button.disabled = false;
    });
    row.append(label, button);
    list.append(row);
  }
}

async function refresh() {
  const data = await chrome.storage.local.get(null);
  const entries = Object.keys(data).filter(key => key.startsWith('account:'))
    .map(key => data[key]).sort((a, b) => b.at - a.at);
  const blocked = entries.filter(item => !item.allowed);
  byId('count').textContent = blocked.length;
  renderList('blocked', blocked);
  renderList('allowed', entries.filter(item => item.allowed));
}

async function save(settings, message) {
  try {
    await chrome.storage.local.set(settings);
    status.textContent = message;
  } catch {
    status.textContent = '設定を保存できませんでした。';
  }
}

chrome.storage.local.get(SETTINGS).then(settings => {
  for (const key of ['enabled', 'images']) {
    const input = byId(key);
    input.checked = settings[key];
    input.addEventListener('change', () => save({ [key]: input.checked }, '設定を保存しました。'));
  }
  byId('terms').value = settings.terms;
  byId('terms').disabled = false;
  byId('save-terms').disabled = false;
});
byId('keywords').addEventListener('submit', event => {
  event.preventDefault();
  const box = byId('terms');
  const terms = termsOf(box.value).join('\n');
  void save({ terms }, 'キーワードを保存しました。開いているXの投稿にも適用します。');
});
byId('manual').addEventListener('submit', async event => {
  event.preventDefault();
  const handle = handleOf(byId('handle').value);
  if (!handle) {
    status.textContent = 'Xのユーザー名を半角英数字と _ で入力してください。';
    return;
  }
  if (await accountAction('add', handle)) byId('handle').value = '';
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.keys(changes).some(key => key.startsWith('account:'))) void refresh();
});
void refresh();
