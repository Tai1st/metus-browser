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

  await delay(5000);
  let picture = '';
  for (let i = 0; i < 25; i++) {
    const thumbs = await getVideoThumbnails(videoId, token);
    const list = thumbs?.thumbnails?.data ?? [];
    const preferred = list.find((t: any) => t?.is_preferred) ?? list[0];
    if (preferred?.uri || thumbs?.picture) {
      picture = preferred?.uri ?? thumbs.picture;
      break;
    }
    await delay(3000);
  }
  return { videoId, picture };
}

export async function getVideoThumbnails(videoId: string, token: string): Promise<any> {
  return exFetch(`${GRAPH}/${videoId}`, {
    params: {
      access_token: token,
      fields: 'id,length,picture,thumbnails{uri,is_preferred}',
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

export interface CreateCarouselParams {
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
}

/** Like bài vừa đăng bằng page access token (best-effort). */
async function likePost(postId: string, pageAccessToken: string): Promise<void> {
  await exFetch(`${GRAPH}/${postId}/likes?metuscors=0`, {
    method: 'POST',
    params: { access_token: pageAccessToken },
  });
}

/** Tạo bài 2 ô (adcreative) rồi publish lên Page. Trả về postId. */
export async function createCarouselPost(p: CreateCarouselParams): Promise<string> {
  const child_attachments = p.cards.map((card, i) => {
    const action = CTA_ACTIONS.find((a) => a.value === card.CTAButton) ?? CTA_ACTIONS[0];
    const call_to_action: { type: string; value?: Record<string, string> } = { type: card.CTAButton };
    let link = `https://facebook.com/${p.page.id}`;
    if (card.CTAButton === 'LIKE_PAGE') {
      call_to_action.value = { page: p.page.id };
    } else if (action.input) {
      link = card.websiteUrl || link;
      call_to_action.value = { link };
    }
    return {
      description: p.watermark && i <= 1 ? 'Đăng 2 ô tại Metus' : card.description,
      name: card.name,
      link,
      video_id: card.video_id,
      picture: card.picture,
      call_to_action,
    };
  });

  const object_story_spec = {
    page_id: p.page.id,
    link_data: {
      message: p.primaryText,
      child_attachments,
      multi_share_optimized: true,
      multi_share_end_card: false,
    },
  };

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
    const eff = await getEffectiveObjectStory(created.id, p.token);
    if (eff?.effective_object_story_id) {
      effectiveId = eff.effective_object_story_id;
      break;
    }
    await delay(3000);
  }
  if (!effectiveId) throw new Error('Không lấy được object story id');

  if (p.scheduleUnix) {
    await schedulePost(effectiveId, p.dtsg, p.scheduleUnix);
  } else {
    await publishStory(effectiveId, p.page.access_token);
  }
  if (p.like) {
    try {
      await likePost(effectiveId, p.page.access_token);
    } catch {
      // like lỗi thì bỏ qua, bài vẫn đã đăng
    }
  }
  return effectiveId;
}
