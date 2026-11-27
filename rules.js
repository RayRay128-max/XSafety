const SETTINGS = { enabled: true, images: true, terms: '' };
const REASONS = {
  warning: 'Xのセンシティブ警告',
  tag: 'ハッシュタグ',
  text: 'ポストの本文',
  image: '画像判定',
  manual: '手動登録',
};
const SITE = /^(www\.)?(x|twitter)\.com$/;
const ADULT = /裏\s*(?:垢|アカ)|(?:エロ|えろ)\s*(?:垢|アカ|動画|画像|写真|配信)|成人向け|性的な(?:画像|動画|写真)|セックス|(?:おなにー|オナニー)|自慰|性交|フェラ(?:チオ|(?![ァ-ヿ\p{L}]))|全裸|無修正(?:動画|画像|写真|av)|(?:^|[^a-z0-9])(?:nsfw|onlyfans|porn(?:ography)?|xxx)(?=$|[^a-z0-9])/iu;
const ADULT_TAG = /^(?:#)?(?:エロ|えろ|アダルト|ヌード|18禁|r_?18(?:_?(?:イラスト|動画|画像))?|18plus)$|自撮り界隈(?:裏|エロ)|エッチな(?:画像|動画)|おっぱい(?:晒し|自撮り)/iu;
const WARNING = /(?:センシティブな|センシティブと判断された)(?:内容|メディア|コンテンツ)|性的なコンテンツ|コンテンツの警告[：:]\s*(?:ヌード|性的)|content warning:\s*(?:nudity|sexual)|sensitive (?:content|media)|graphic nudity|adult content/iu;

function normalize(value) {
  return String(value ?? '').normalize('NFKC').replace(/[\u200b-\u200d\ufeff]/gu, '').replace(/\s+/gu, ' ').toLowerCase();
}

function handleOf(value) {
  return typeof value === 'string' ? /^@?([a-z0-9_]{1,15})$/i.exec(value.trim())?.[1].toLowerCase() : undefined;
}

function termsOf(value) {
  return String(value ?? '').split(/[\r\n,，、]+/u).map(text => normalize(text).trim()).filter(term => term && term !== '#');
}

function reasonFor(body, tags, warning, terms) {
  if (warning) return 'warning';
  const custom = termsOf(terms);
  if (tags.map(normalize).some(tag => ADULT.test(tag) || ADULT_TAG.test(tag) ||
      custom.some(term => tag.includes(term.replace(/^#/, ''))))) return 'tag';
  const text = normalize(body);
  if (ADULT.test(text) || custom.some(term => !term.startsWith('#') && text.includes(term))) {
    return 'text';
  }
}

function imageSource(value) {
  try {
    const url = new URL(value);
    if (url.origin !== 'https://pbs.twimg.com' ||
        !/^\/(?:media|ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb)\//.test(url.pathname)) return;
    url.hash = '';
    url.searchParams.set('name', 'small');
    return url.href;
  } catch {
    return undefined;
  }
}

function imageIsSensitive(scores) {
  if (!scores) return false;
  const { Porn = 0, Hentai = 0, Sexy = 0 } = scores;
  return Porn + Hentai >= 0.80 || Sexy >= 0.78 || Porn >= 0.35 && Porn + Sexy >= 0.86;
}
