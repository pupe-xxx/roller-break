// 表示の言葉。ブラウザの言語が日本語なら日本語、それ以外は英語で出す。
// URL に ?lang=ja / ?lang=en を付けると、ブラウザの言語より優先する
const urlLang = globalThis.location ? new URLSearchParams(globalThis.location.search).get('lang') : null;
const lang = urlLang ?? globalThis.navigator?.language ?? 'en';
const japanese = lang.toLowerCase().startsWith('ja');

export const t = (ja: string, en: string): string => (japanese ? ja : en);
