function exportBackup(data) {
  return {
    format: 'XSafety',
    version: 1,
    exportedAt: new Date().toISOString(),
    keywords: termsOf(data.terms),
    accounts: Object.entries(data).filter(([key, item]) =>
      key.startsWith('account:') && item && handleOf(item.handle)
    ).map(([, item]) => ({
      username: '@' + handleOf(item.handle),
      allowed: Boolean(item.allowed),
      reason: Object.hasOwn(REASONS, item.reason) ? item.reason : 'manual',
      at: Number.isFinite(item.at) ? item.at : Date.now(),
    })),
  };
}

function parseBackup(data) {
  if (!data || data.format !== 'XSafety' || data.version !== 1 ||
      !Array.isArray(data.keywords) || !Array.isArray(data.accounts) ||
      data.keywords.some(word => typeof word !== 'string' || word.length > 1000)) {
    throw new Error('XSafetyの保存ファイルを選んでください。');
  }
  const accounts = new Map();
  for (const item of data.accounts) {
    const handle = handleOf(item?.username);
    if (!handle || typeof item.allowed !== 'boolean') {
      throw new Error('ファイル内のアカウント情報が正しくありません。');
    }
    accounts.set(handle, {
      handle,
      allowed: item.allowed,
      reason: Object.hasOwn(REASONS, item.reason) ? item.reason : 'manual',
      at: Number.isFinite(item.at) && item.at > 0 ? item.at : Date.now(),
    });
  }
  return { keywords: termsOf(data.keywords.join('\n')), accounts };
}

function backupToText(data) {
  const lines = ['XSafety 登録データ v1'];
  for (const word of data.keywords) lines.push('キーワード\t' + word);
  for (const item of data.accounts) {
    lines.push([
      item.allowed ? '除外' : '非表示',
      item.username,
      item.reason,
      item.at,
    ].join('\t'));
  }
  return lines.join('\r\n') + '\r\n';
}

function backupFromText(text) {
  const source = text.replace(/^\uFEFF/, '').trim();
  if (source.startsWith('{')) {
    const data = JSON.parse(source);
    parseBackup(data);
    return data;
  }
  const lines = source.split(/\r?\n/);
  if (!['XSafety 登録データ v1', 'Xセフティ 登録データ v1'].includes(lines.shift())) {
    throw new Error('XSafetyで保存したTXTまたはJSONファイルを選んでください。');
  }
  const data = { format: 'XSafety', version: 1, keywords: [], accounts: [] };
  for (const line of lines) {
    if (!line.trim()) continue;
    const [type, value, reason = 'manual', at] = line.split('\t');
    if (type === 'キーワード' && value && line.split('\t').length === 2) {
      data.keywords.push(value);
    } else if ((type === '非表示' || type === '除外') && value) {
      data.accounts.push({
        username: value,
        allowed: type === '除外',
        reason,
        at: at ? Number(at) : Date.now(),
      });
    } else {
      throw new Error('テキストファイルの行の形式を確認してください。');
    }
  }
  parseBackup(data);
  return data;
}
