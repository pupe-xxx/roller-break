// 動作記録との照合。
// 決まった場面（種を固定した試合・決まった入力）の結果を記録しておき、テストのたびに同じ結果になるか比べる。
// ルールや CPU の動きが意図せず変わった時に気づける。
// 何を記録するかは tests/golden/cases.ts に書く。記録の取り直しは `npm run record`。

/** 1つの場面の記録。途中の状態を順に並べたもの（1手ごとの盤面など） */
export type Trace = string[];

/** キーの並び順に左右されない JSON。同じ状態なら、書き方を変えても同じ文字列になる */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
}

/** 状態を16文字に縮めたもの。状態が少しでも違えば別の文字列になる */
export function fingerprint(value: unknown): string {
  const s = canonical(value);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return hex(h2) + hex(h1);
}

/** 記録と今の結果を比べ、食い違いを文で返す。空なら全部一致 */
export function diffTraces(recorded: Record<string, Trace>, current: Record<string, Trace>): string[] {
  const problems: string[] = [];
  for (const name of new Set([...Object.keys(recorded), ...Object.keys(current)])) {
    const was = recorded[name], now = current[name];
    if (!was) problems.push(`${name}: 記録に無い（npm run record で取り直す）`);
    else if (!now) problems.push(`${name}: 記録にはあるが、今は無い`);
    else {
      const at = now.findIndex((v, i) => v !== was[i]);
      if (at >= 0) problems.push(`${name}: ${at} 番目で食い違い`);
      else if (now.length !== was.length) problems.push(`${name}: 長さが違う（記録 ${was.length}・今 ${now.length}）`);
    }
  }
  return problems;
}
