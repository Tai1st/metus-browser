import native from './src/MetusHttpModule';
import { createMetus } from './src/client';

/**
 * API chính: `Metus.http.request()`, `Metus.http.get()`, `Metus.http.post()`,
 * `Metus.accounts.*`. Request chạy bằng native (OkHttp / URLSession), không CORS.
 */
export const Metus = createMetus(native);
export default Metus;

export { MetusHttpError, createMetus } from './src/client';
export type { Metus as MetusApi, MetusAccounts } from './src/client';
export { fileBody, stripXssi } from './src/serialize';
export { bytesToBase64, base64ToBytes } from './src/base64';
export * from './src/types';
