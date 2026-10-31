/**
 * Clone bài viết từ Trang khác lên Trang của mình — port từ metus-few
 * features/tools/page/page-posts-clone/hooks/usePagePostClone.ts
 * (cloneSinglePost + uploadPhotoByUrl). Dùng Graph API qua `exFetch`, giống
 * videoCarousel.ts/pagePostAnalyze.ts.
 */
import { exFetch } from './compat';
import type { PagePostRow } from './pagePostAnalyze';

const GRAPH = 'https://graph.facebook.com/v21.0';

/** Upload ảnh từ URL vào thư viện ảnh ẩn (`published=false`) của Page, trả photo fbid để đính kèm bài viết. */
export async function uploadPhotoByUrl(pageAccessToken: string, pageId: string, imageUrl: string): Promise<string | null> {
  const form = new URLSearchParams({ url: imageUrl, access_token: pageAccessToken, published: 'false' });
  const data = await exFetch<any>(`${GRAPH}/${pageId}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (data?.id) return data.id;
  throw new Error(data?.error?.message ?? 'Upload photo failed');
}

export interface CloneResult {
  success: boolean;
  postId?: string;
  error?: string;
}

/** Đăng lại 1 bài (video/link/shared/album/photo/text) lên Page đích — trả postId nếu thành công. */
export async function cloneSinglePost(
  destPage: { id: string; access_token: string },
  sourcePost: PagePostRow,
  finalMessage: string,
  scheduledUnix?: number,
  hideAfterShare?: boolean,
): Promise<CloneResult> {
  try {
    const pageAccessToken = destPage.access_token;
    const pageId = destPage.id;
    const { type, image, attachments, permalinkUrl } = sourcePost;

    const buildBody = (extra: Record<string, unknown> = {}) => {
      // Facebook trả lỗi "(#100) You cannot specify a scheduled publish time on
      // a published post" nếu thiếu published:false khi hẹn giờ.
      const body: Record<string, unknown> = { message: finalMessage, access_token: pageAccessToken, ...extra };
      if (scheduledUnix) {
        body.published = false;
        body.scheduled_publish_time = scheduledUnix;
      }
      return body;
    };

    const hideIfNeeded = async (postId: string) => {
      if (hideAfterShare) {
        await exFetch(`${GRAPH}/${postId}`, { method: 'DELETE', params: { access_token: pageAccessToken } }).catch(() => {});
      }
    };

    if (type === 'video') {
      const videoAttach = attachments.find((a) => a.type === 'video' || a.type === 'video_autoplay');
      const videoUrl = videoAttach?.media?.source ?? videoAttach?.url ?? '';
      if (!videoUrl) throw new Error('Cannot find video URL');
      const isScheduled = !!scheduledUnix;
      const form = new URLSearchParams({
        file_url: videoUrl,
        description: finalMessage,
        access_token: pageAccessToken,
        published: isScheduled ? 'false' : 'true',
      });
      if (isScheduled) form.set('scheduled_publish_time', String(scheduledUnix));
      const result = await exFetch<any>(`${GRAPH}/${pageId}/videos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      if (!result?.id) throw new Error(result?.error?.message ?? 'Video post failed');
      await hideIfNeeded(result.id);
      return { success: true, postId: result.id };
    }

    if (type === 'link' || type === 'shared') {
      const linkAttach = attachments.find((a) => a.type === 'link');
      const linkUrl = linkAttach?.url ?? permalinkUrl;
      const result = await exFetch<any>(`${GRAPH}/${pageId}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: buildBody({ link: linkUrl }),
      });
      if (!result?.id) throw new Error(result?.error?.message ?? 'Link post failed');
      await hideIfNeeded(result.id);
      return { success: true, postId: result.id };
    }

    if (type === 'album' && attachments.length) {
      // Giống metus-few gốc: lọc attachments cấp cao nhất có type 'photo' (không phải subattachments).
      const photos = attachments.filter((a) => a.type === 'photo');
      const firstPhotoUrl = photos[0]?.media?.image?.src ?? photos[0]?.url;
      if (!firstPhotoUrl) throw new Error('No photo in album');
      const uploadedFbid = await uploadPhotoByUrl(pageAccessToken, pageId, firstPhotoUrl).catch(() => null);
      const body = buildBody(uploadedFbid ? { attached_media: JSON.stringify([{ media_fbid: uploadedFbid }]) } : {});
      const result = await exFetch<any>(`${GRAPH}/${pageId}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (!result?.id) throw new Error(result?.error?.message ?? 'Album post failed');
      await hideIfNeeded(result.id);
      return { success: true, postId: result.id };
    }

    // photo / text / others
    let attachedMedia: string | undefined;
    if (type === 'photo' && image) {
      const uploadedFbid = await uploadPhotoByUrl(pageAccessToken, pageId, image).catch(() => null);
      if (uploadedFbid) attachedMedia = JSON.stringify([{ media_fbid: uploadedFbid }]);
    }
    const body = buildBody(attachedMedia ? { attached_media: attachedMedia } : {});
    const result = await exFetch<any>(`${GRAPH}/${pageId}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!result?.id) throw new Error(result?.error?.message ?? 'Post failed');
    await hideIfNeeded(result.id);
    return { success: true, postId: result.id };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
