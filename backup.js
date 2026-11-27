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
    throw new Error('Xセフティの保存ファイルを選んでください。');
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
