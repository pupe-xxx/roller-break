// 表示の言葉。ブラウザの言語が日本語なら日本語、それ以外は英語で出す。
const japanese = (globalThis.navigator?.language ?? 'en').toLowerCase().startsWith('ja');

export const t = (ja: string, en: string): string => (japanese ? ja : en);
