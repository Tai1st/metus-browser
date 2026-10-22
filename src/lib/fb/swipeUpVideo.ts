// Dịch vụ "Swipe Up Video" — port từ metus-few (SwipeUpVideo.ts). Tạo một Instant
// Experience (Canvas) 1 ảnh có link vuốt lên, rồi tạo adcreative video gắn Canvas
// đó, publish bài lên Page (giống luồng carousel: tạo creative → chờ
// effective_object_story_id → publish bằng page access token).
import { exFetch, instance } from './compat';

const GRAPH = 'https://graph.facebook.com';
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Canvas {
  id: string;
  background_color?: string;
  is_published?: boolean;
  collection_hero_image?: { images?: Array<{ source: string }> };
  style_list?: string[];
  element_payload?: string;
  name?: string;
  created_time?: string;
}

export interface GetCanvasesResponse {
  data: Canvas[];
}

/** Canvas đã publish của Page (thư viện Canvas có sẵn, dùng lại thay vì tạo mới). */
export async function getPageCanvases(pageId: string, token: string, opts?: { limit?: number; isPublished?: boolean }): Promise<GetCanvasesResponse> {
  const res = await exFetch<any>(`${GRAPH}/v21.0/${pageId}/canvases`, {
    params: {
      access_token: token,
      fields: 'id,background_color,is_published,collection_hero_image{images{source}},style_list,element_payload,name,created_time',
      limit: opts?.limit ?? 50,
      is_published: opts?.isPublished,
      metuscors: 0,
    },
  });
  return { data: Array.isArray(res?.data) ? res.data : [] };
}

export const getCanvasThumbnail = (canvas: Canvas): string | null => canvas.collection_hero_image?.images?.[0]?.source ?? null;
export const getCanvasName = (canvas: Canvas): string => canvas.name || `Canvas ${canvas.id.slice(0, 8)}`;

/** Danh sách ảnh bìa (thumbnail) để người dùng chọn cho video vừa upload. */
export async function getVideoThumbnailChoices(videoId: string, token: string): Promise<{ id: string; url: string }[]> {
  for (let i = 0; i < 20; i++) {
    const res = await exFetch<any>(`${GRAPH}/${videoId}`, { params: { access_token: token, fields: 'thumbnails', metuscors: 0 } });
    const list: any[] = res?.thumbnails?.data ?? [];
    if (list.length > 1) return list.map((t) => ({ id: String(t.id), url: t.uri }));
    await delay(3000);
  }
  return [];
}

/** Upload 1 ảnh (base64/URL máy) lên adimages của ad account → id/url ảnh Facebook. */
async function uploadPhotoForCanvas(adAccountId: string, token: string, uri: string, name: string, mimeType: string): Promise<{ hash: string; url: string }> {
  const fd = new FormData();
  fd.append('image', { uri, name, type: mimeType } as unknown as Blob);
  const { data } = await instance.post<any>(`${GRAPH}/v21.0/${adAccountId}/adimages`, fd, {
    params: { access_token: token, fields: 'hash,url', metuscors: 0 },
    responseType: 'json',
  });
  const img = data?.images ? Object.values<any>(data.images)[0] : undefined;
  if (!img?.url) throw new Error('Upload ảnh Canvas thất bại');
  return { hash: img.hash, url: img.url };
}
export { uploadPhotoForCanvas as uploadCanvasImage };

/** Lấy photo_id (bootstrap nội bộ Canvas editor) từ URL ảnh đã có trên Facebook. */
export async function getPhotoIdFromImageUrl(imageUrl: string, pageId: string, dtsg: string, userId: string): Promise<string> {
  const fd = new FormData();
  fd.append('fb_dtsg', dtsg);
  fd.append('__a', '1');
  fd.append('__user', userId);
  const { data } = await instance.post<string>(
    `https://adsmanager.facebook.com/ads/canvas/upload/photo/?metuscors=0&photo_url=${encodeURIComponent(imageUrl)}&av=${pageId}`,
    fd,
    { responseType: 'text' },
  );
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  const json = JSON.parse(text.replace(/^for \(;;\);/, ''));
  const photoId = json?.payload?.photo?.id;
  if (!photoId) throw new Error('Không lấy được photo_id cho Canvas');
  return String(photoId);
}

/** Tạo 1 phần tử Canvas (ảnh có link vuốt lên). */
export async function createCanvasElement(photoId: string, linkUrl: string, pageId: string, adAccountId: string, userId: string, token: string): Promise<string> {
  const canvasPhoto = JSON.stringify({
    name: 'Photo',
    bottom_padding: '0',
    top_padding: '0',
    deep_link: null,
    open_url_action: { url: linkUrl },
    style: 'FIT_TO_WIDTH',
    element_group_key: null,
    hide_product_prices: false,
    photo_id: Number(photoId),
    product_tags: null,
  });
  const body = new URLSearchParams({ canvas_photo: canvasPhoto, __ad_account_id: adAccountId, __a: '1', __user: userId });
  const data = await exFetch<{ id?: string; error?: { message?: string } }>(
    `${GRAPH}/v21.0/${pageId}/canvas_elements/?access_token=${token}&method=post&metuscors=0`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() },
  );
  if (!data.id) throw new Error(data.error?.message ?? 'Không tạo được canvas element');
  return data.id;
}

/** Tạo Canvas mới (chưa publish) từ các phần tử đã tạo. */
export async function createCanvasFromElements(elementIds: string[], name: string, pageId: string, userId: string, token: string): Promise<string> {
  const body = new URLSearchParams({
    enable_swipe_to_open: 'true',
    is_hidden: 'false',
    body_element_ids: JSON.stringify(elementIds),
    'background_color:': 'FFe31d1d',
    'name:': name,
    __a: '1',
    __user: userId,
  });
  const data = await exFetch<{ id?: string; error?: { message?: string } }>(
    `${GRAPH}/v21.0/${pageId}/canvases/?access_token=${token}&method=post&metuscors=0`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() },
  );
  if (!data.id) throw new Error(data.error?.message ?? 'Không tạo được canvas');
  return data.id;
}

/** Publish Canvas vừa tạo (bắt buộc trước khi dùng trong adcreative). */
export async function publishCanvas(canvasId: string, elementIds: string[], name: string, userId: string, token: string): Promise<void> {
  const body = new URLSearchParams({
    enable_swipe_to_open: 'true',
    is_hidden: 'false',
    body_element_ids: JSON.stringify(elementIds),
    'background_color:': 'FFe31d1d',
    'name:': name,
    __a: '1',
    __user: userId,
    is_published: 'true',
  });
  const data = await exFetch<{ error?: { message?: string } }>(
    `${GRAPH}/v21.0/${canvasId}/?access_token=${token}&method=post&metuscors=0`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() },
  );
  if (data?.error) throw new Error(data.error.message ?? 'Không xuất bản được Canvas');
}

/** Tạo adcreative video gắn Canvas (nút "Tìm hiểu thêm" trỏ tới fb.com/canvas_doc/<id>). */
export async function createSwipeUpCreative(p: {
  adAccountId: string;
  token: string;
  pageId: string;
  videoId: string;
  imageUrl: string;
  message: string;
  title: string;
  canvasId: string;
}): Promise<string> {
  const body = {
    object_story_spec: {
      page_id: p.pageId,
      video_data: {
        video_id: p.videoId,
        image_url: p.imageUrl,
        title: p.title,
        message: p.message,
        call_to_action: { type: 'LEARN_MORE', value: { link: `https://fb.com/canvas_doc/${p.canvasId}` } },
      },
    },
  };
  const data = await exFetch<{ id?: string; error?: { message?: string } }>(
    `${GRAPH}/v21.0/act_${p.adAccountId.replace(/^act_/, '')}/adcreatives?metuscors=0`,
    { method: 'POST', body, params: { access_token: p.token, fields: 'id' }, headers: { 'Content-Type': 'application/json' } },
  );
  if (!data.id) throw new Error(data.error?.message ?? 'Không tạo được creative');
  return data.id;
}

/** Chờ Facebook chuyển creative thành bài viết thật (effective_object_story_id). */
export async function getCreativeStoryId(creativeId: string, token: string): Promise<string> {
  for (let i = 0; i < 25; i++) {
    const data = await exFetch<{ effective_object_story_id?: string }>(`${GRAPH}/v21.0/${creativeId}`, {
      params: { access_token: token, fields: 'effective_object_story_id', metuscors: 0 },
    });
    if (data.effective_object_story_id) return data.effective_object_story_id;
    await delay(3000);
  }
  throw new Error('Không lấy được effective_object_story_id sau nhiều lần thử');
}

/** Publish bài viết (bằng page access token) để hiện công khai trên Page. */
export async function publishSwipeUpStory(storyId: string, pageAccessToken: string): Promise<void> {
  const data = await exFetch<{ success?: boolean }>(`${GRAPH}/v21.0/${storyId}`, {
    method: 'POST',
    body: { is_published: true },
    params: { access_token: pageAccessToken, metuscors: 0 },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!data.success) throw new Error('Không xuất bản được bài viết');
}
