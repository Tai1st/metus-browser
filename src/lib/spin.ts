/**
 * Spin nội dung giống metus-few (utils/random.ts + comment.utils.ts):
 * - [[a || b || c]]       → chọn 1
 * - {a|b|c}               → chọn 1
 * - [a|b]                 → chọn 1
 * - {{RAN_T (n)}}         → n chữ ngẫu nhiên
 * - {{RAN_D (n)}}         → n số ngẫu nhiên
 * - {{RAN_M (n)}}         → n emoji ngẫu nhiên
 */
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const EMOJIS = ['😀', '😁', '😂', '🤣', '😃', '😄', '😅', '😆', '😉', '😊', '😋', '😎', '😍', '😘', '🤗', '🤩', '🤔', '😏', '😌', '😛', '😜', '🥰', '🥳', '😇', '🙌', '👏', '👍', '🔥', '💯', '✨', '🎉', '❤️', '💖', '🌟', '⭐', '🌈', '🍀', '🎁', '📣', '✅'];

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const repeat = (n: number, f: () => string) => Array.from({ length: n }, f).join('');

export function spinContent(raw: string): string {
  let s = raw;
  s = s.replace(/\[\[([\s\S]*?)\]\]/g, (_, g: string) => pick(g.split('||').map((o) => o.trim())));
  s = s.replace(/{{RAN_T \((\d+)\)}}/g, (_, n: string) => repeat(+n, () => pick([...LETTERS])));
  s = s.replace(/{{RAN_D \((\d+)\)}}/g, (_, n: string) => repeat(+n, () => String(Math.floor(Math.random() * 10))));
  s = s.replace(/{{RAN_M \((\d+)\)}}/g, (_, n: string) => repeat(+n, () => pick(EMOJIS)));
  s = s.replace(/\{([^{}]+)\}/g, (_, g: string) => pick(g.split('|')));
  s = s.replace(/\[([^[\]]*\|[^[\]]*)\]/g, (_, g: string) => pick(g.split('|')));
  return s;
}
