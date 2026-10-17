// Dịch vụ tạo bài "2 ô" (carousel) qua Facebook Ads API — port từ metus-few
// (AdCreatives.ts + FbVideoCarousel.ts). Upload ảnh/video từ máy, tạo adcreative
// 2 thẻ rồi publish lên Page. Dùng Metus native HTTP (compat.exFetch/instance).
import { exFetch, instance } from './compat';

const GRAPH = 'https://graph.facebook.com';
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface PickedMedia {
  uri: string;
  name: string;
  mimeType?: string;
}

/** Nút kêu gọi hành động (CTA) cho mỗi thẻ. */
export const CTA_ACTIONS: { value: string; label: string; input: boolean }[] = [
  { value: 'LIKE_PAGE', label: 'Thích Trang', input: false },
  { value: 'SHOP_NOW', label: 'Mua ngay', input: true },
  { value: 'LEARN_MORE', label: 'Tìm hiểu thêm', input: true },
  { value: 'SIGN_UP', label: 'Đăng ký', input: true },
  { value: 'BOOK_TRAVEL', label: 'Đặt ngay', input: true },
];

export interface CardData {
  picture: string; // url ảnh (thumbnail nếu là video)
  /** Ảnh xem trước tại máy (hiện ngay khi chọn, trước khi upload xong). */
  preview?: string;
  video_id?: string;
  name: string;
  description: string;
  CTAButton: string;
  websiteUrl: string;
}

/** Upload 1 ảnh từ máy lên ad account, trả về url. */
export async function uploadAdImage(adAccountId: string, token: string, file: PickedMedia): Promise<{ url: string; hash: string }> {
  const fd = new FormData();
  fd.append('image', { uri: file.uri, name: file.name, type: file.mimeType ?? 'image/jpeg' } as unknown as Blob);
  const { data } = await instance.post<any>(`${GRAPH}/v21.0/${adAccountId}/adimages`, fd, {
    params: { access_token: token, fields: 'hash,url,url_128', metuscors: 0 },
    responseType: 'json',
  });
  const img = data?.images?.[file.name] ?? (data?.images ? Object.values<any>(data.images)[0] : undefined);
  if (!img?.url) throw new Error('Upload ảnh thất bại');
  return { url: img.url, hash: img.hash };
}

/** Upload 1 video từ máy lên ad account; đợi thumbnail; trả video_id + ảnh bìa. */
export async function uploadAdVideo(adAccountId: string, token: string, file: PickedMedia): Promise<{ videoId: string; picture: string }> {
  const fd = new FormData();
  fd.append('source', { uri: file.uri, name: file.name, type: file.mimeType ?? 'video/mp4' } as unknown as Blob);
  const { data } = await instance.post<any>(`${GRAPH}/v21.0/${adAccountId}/advideos`, fd, {
    params: { access_token: token, metuscors: 0 },
    responseType: 'json',
  });
  const videoId = data?.id;
  if (!videoId) throw new Error('Upload video thất bại');
  return { videoId, picture: await waitVideoThumbnail(videoId, token) };
}

/** Đợi Facebook xử lý video và trả ảnh bìa (thumbnail ưu tiên, hoặc `picture`). */
export async function waitVideoThumbnail(videoId: string, token: string): Promise<string> {
  await delay(4000);
  let lastErr = '';
  // ~3 phút: video dài/nặng Facebook xử lý lâu mới có thumbnail
  for (let i = 0; i < 45; i++) {
    try {
      let thumbs = await getVideoThumbnails(videoId, token);
      // Graph đôi khi trả content-type text/javascript → exFetch không tự parse
      if (typeof thumbs === 'string') thumbs = JSON.parse(thumbs);
      if (thumbs?.error) {
        lastErr = thumbs.error.message ?? JSON.stringify(thumbs.error);
        console.warn('[thumb]', videoId, 'lỗi', lastErr);
      } else {
        const list: any[] = thumbs?.thumbnails?.data ?? [];
        const preferred = list.find((t) => t?.is_preferred) ?? list[0];
        console.log('[thumb]', videoId, `lần ${i + 1}`, 'thumbnails:', list.length, 'picture:', !!thumbs?.picture, 'status:', thumbs?.status?.video_status);
        if (preferred?.uri) return preferred.uri;
        // `picture` có sẵn ngay cả khi chưa xử lý xong (ảnh xám) → chỉ dùng khi video đã sẵn sàng
        if (thumbs?.picture && thumbs?.status?.video_status === 'ready') return thumbs.picture;
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      console.warn('[thumb]', videoId, 'exception', lastErr);
    }
    await delay(i < 10 ? 2000 : 4000);
  }
  throw new Error(`Không lấy được ảnh bìa video${lastErr ? `: ${lastErr}` : ' (Facebook chưa xử lý xong video, thử lại sau)'}`);
}

export async function getVideoThumbnails(videoId: string, token: string): Promise<any> {
  return exFetch(`${GRAPH}/${videoId}`, {
    params: {
      access_token: token,
      fields: 'id,length,picture,status,thumbnails{uri,is_preferred}',
      metuscors: 0,
    },
  });
}

async function getEffectiveObjectStory(storyId: string, token: string): Promise<any> {
  return exFetch(`${GRAPH}/${storyId}?metuscors=0&access_token=${token}&fields=effective_object_story_id`);
}

async function publishStory(effectiveStoryId: string, pageAccessToken: string): Promise<void> {
  await exFetch(`${GRAPH}/v16.0/${effectiveStoryId}?metuscors=0`, {
    method: 'POST',
    body: { is_published: true },
    params: { access_token: pageAccessToken },
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Hẹn lịch đăng bài (business graphql) — port từ metus-few postSchedule. */
async function schedulePost(effectiveStoryId: string, dtsg: string, scheduledUnix: number): Promise<void> {
  const pageId = effectiveStoryId.split('_')[0];
  const storyId = effectiveStoryId.split('_')[1];
  const fd = new FormData();
  fd.append('fb_dtsg', dtsg);
  fd.append('av', pageId);
  fd.append('server_timestamps', 'true');
  fd.append('doc_id', '5001941423228398');
  fd.append('variables', JSON.stringify({
    input: {
      client_mutation_id: '4',
      actor_id: pageId,
      story_ids: [`S:_I${pageId}:${storyId}`],
      page_id: pageId,
      scheduled_publish_time: scheduledUnix,
    },
  }));
  await instance.post('https://business.facebook.com/api/graphql/?metuscors=0', fd, { responseType: 'text' });
}

/** Loại bài Ads: 2 ô (carousel), video 1 ô, ảnh 1 ô. */
export type AdPostMode = 'carousel2' | 'oneVideo' | 'onePicture' | 'fakeAlbum';

export interface CreateCarouselParams {
  /** Mặc định 'carousel2'. */
  mode?: AdPostMode;
  /** Ảnh 1 ô: link hiển thị (caption), ví dụ "facebook.com". */
  displayLink?: string;
  /** Ảnh 1 ô: mô tả dưới link hiển thị. */
  displayLinkDescription?: string;
  /** Album giả: url ảnh ghép đã upload. */
  albumImageUrl?: string;
  /** Album giả: link đích (affiliate) khi bấm vào ảnh. */
  websiteUrl?: string;
  /** Tạo bài nhưng KHÔNG publish (bài ẩn, chỉ dùng chạy quảng cáo). */
  hidePost?: boolean;
  token: string;
  adAccountId: string;
  page: { id: string; name: string; access_token: string };
  dtsg: string;
  fbId: string;
  primaryText: string;
  cards: CardData[];
  watermark?: boolean;
  like?: boolean;
  /** Unix time (giây) để hẹn lịch; bỏ trống = đăng ngay. */
  scheduleUnix?: number;
  /** Tiến độ 0..1 của bài trên Page này (để hiện thanh %). */
  onProgress?: (fraction: number) => void;
}

/** Like bài vừa đăng bằng page access token (best-effort). */
async function likePost(postId: string, pageAccessToken: string): Promise<void> {
  await exFetch(`${GRAPH}/${postId}/likes?metuscors=0`, {
    method: 'POST',
    params: { access_token: pageAccessToken },
  });
}

/** Nút CTA + link đích của 1 thẻ (giống metus-few). */
function ctaFor(card: CardData, pageId: string): { link: string; call_to_action: { type: string; value?: Record<string, string> } } {
  const action = CTA_ACTIONS.find((a) => a.value === card.CTAButton) ?? CTA_ACTIONS[0];
  const call_to_action: { type: string; value?: Record<string, string> } = { type: card.CTAButton };
  let link = `https://facebook.com/${pageId}`;
  if (card.CTAButton === 'LIKE_PAGE') {
    call_to_action.value = { page: pageId };
  } else if (action.input) {
    link = card.websiteUrl || link;
    call_to_action.value = { link };
  }
  return { link, call_to_action };
}

/** Dựng object_story_spec theo loại bài — port từ 3 tool tương ứng của metus-few. */
function buildObjectStorySpec(p: CreateCarouselParams): Record<string, unknown> {
  const mode = p.mode ?? 'carousel2';
  const pageId = p.page.id;

  // Album giả: 1 ảnh ghép, tên/mô tả để khoảng trắng để FB không hiện khung link.
  if (mode === 'fakeAlbum') {
    return {
      page_id: pageId,
      link_data: {
        picture: p.albumImageUrl,
        link: p.websiteUrl,
        multi_share_optimized: true,
        multi_share_end_card: false,
        caption: p.displayLink,
        description: '           ',
        name: '         ',
        message: p.primaryText,
      },
    };
  }

  if (mode === 'carousel2') {
    const FREE_PLAN_IMAGE = 'https://i.ibb.co/HLkTLjYV/image.png';
    const child_attachments = p.cards.map((card, i) => {
      const { link, call_to_action } = ctaFor(card, pageId);
      return {
        // Gói miễn phí/hết hạn (giống metus-few): cả 2 thẻ ghi watermark, thẻ 2 thay bằng ảnh Metus
        description: p.watermark && i <= 1 ? 'Đăng 2 ô tại Metus' : card.description,
        name: card.name,
        link,
        video_id: card.video_id,
        picture: p.watermark && i === 1 ? FREE_PLAN_IMAGE : card.picture,
        call_to_action,
      };
    });
    return {
      page_id: pageId,
      link_data: { message: p.primaryText, child_attachments, multi_share_optimized: true, multi_share_end_card: false },
    };
  }

  const card = p.cards[0];
  const { link, call_to_action } = ctaFor(card, pageId);

  // Video 1 ô: video_data; bỏ hẳn field rỗng (message/description) như Ads Manager.
  if (mode === 'oneVideo' && card.video_id) {
    return {
      page_id: pageId,
      video_data: {
        video_id: card.video_id,
        image_url: card.picture || '',
        call_to_action,
        title: card.name || '',
        link_description: link,
        ...(p.primaryText ? { message: p.primaryText } : {}),
        ...(card.description ? { description: card.description } : {}),
      },
    };
  }

  // Ảnh 1 ô (hoặc tool video nhưng thẻ là ảnh): link_data.
  const link_data: Record<string, unknown> = {
    message: p.primaryText,
    link,
    picture: card.picture,
    name: card.name,
    description: card.description,
    call_to_action,
  };
  if (mode === 'onePicture') {
    link_data.description = p.displayLinkDescription || card.description || '';
    link_data.caption = p.displayLink || link;
    link_data.multi_share_end_card = false;
    link_data.multi_share_optimized = true;
  }
  return { page_id: pageId, link_data };
}

/** Tạo bài Ads (2 ô / video 1 ô / ảnh 1 ô) rồi publish (hoặc hẹn lịch) lên Page. Trả về postId. */
export async function createCarouselPost(p: CreateCarouselParams): Promise<string> {
  const object_story_spec = buildObjectStorySpec(p);

  p.onProgress?.(0.1);
  const created = await exFetch<{ id: string }>(
    `${GRAPH}/v21.0/${p.adAccountId}/adcreatives?metuscors=0`,
    {
      method: 'POST',
      body: { object_story_spec },
      params: { access_token: p.token, fields: 'effective_object_story_id' },
      headers: { 'Content-Type': 'application/json' },
    },
  );

  let effectiveId = '';
  for (let i = 0; i < 25; i++) {
    p.onProgress?.(0.3 + Math.min(i, 10) * 0.05);
    const eff = await getEffectiveObjectStory(created.id, p.token);
    if (eff?.effective_object_story_id) {
      effectiveId = eff.effective_object_story_id;
      break;
    }
    await delay(3000);
  }
  if (!effectiveId) throw new Error('Không lấy được object story id');

  p.onProgress?.(0.85);
  if (p.hidePost) {
    // bài ẩn: không publish / không hẹn lịch
  } else if (p.scheduleUnix) {
    await schedulePost(effectiveId, p.dtsg, p.scheduleUnix);
  } else {
    await publishStory(effectiveId, p.page.access_token);
  }
  if (p.like && !p.hidePost) {
    try {
      await likePost(effectiveId, p.page.access_token);
    } catch {
      // like lỗi thì bỏ qua, bài vẫn đã đăng
    }
  }
  p.onProgress?.(1);
  return effectiveId;
}

export interface AdImage {
  hash: string;
  url: string;
}

/** Thư viện ảnh đã upload lên ad account (GET /{act}/adimages). */
export async function getAdImages(adAccountId: string, token: string): Promise<AdImage[]> {
  const res = await exFetch<any>(`${GRAPH}/v21.0/${adAccountId}/adimages`, {
    params: { access_token: token, fields: 'hash,url', limit: 100, metuscors: 0 },
  });
  const data: any[] = res?.data ?? [];
  return data.filter((x) => x?.url).map((x) => ({ hash: String(x.hash), url: String(x.url) }));
}

/** Xóa 1 ảnh khỏi thư viện ad account theo hash. */
export async function deleteAdImage(adAccountId: string, token: string, hash: string): Promise<void> {
  await exFetch(`${GRAPH}/v21.0/${adAccountId}/adimages`, {
    method: 'DELETE',
    params: { access_token: token, hash, metuscors: 0 },
  });
}
