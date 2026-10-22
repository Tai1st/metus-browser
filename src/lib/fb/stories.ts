/**
 * Đăng Story cho Page — port từ metus-few services/facebook/UpToStories.ts.
 * Dùng cookie Facebook của tài khoản (av = Page): upload ảnh / video (resumable upload)
 * rồi tạo Story bằng GraphQL `xfamily_content_create` (kênh FACEBOOK_STORY).
 */
import { fileBody } from '@metus/http';
import * as Crypto from 'expo-crypto';

import { tr } from '../i18n';
import { instance } from './compat';
import type { LocalFile } from './Group';

const parse = (data: unknown): any => {
  if (typeof data !== 'string') return data;
  const parts = data.split('for (;;);');
  try {
    return JSON.parse((parts.length > 1 ? parts[1] : parts[0]).trim());
  } catch {
    return null;
  }
};
const rnd = (len: number) => Array.from({ length: len }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)]).join('');
const mutationId = () => String(1 + Math.floor(Math.random() * 18));
const TEXT = { responseType: 'text' as const, transformResponse: (r: unknown) => r };

/** Upload ảnh Story → photoID. */
export async function uploadStoryPhoto(dtsg: string, pageId: string, file: LocalFile): Promise<string> {
  const form = new FormData();
  form.append('source', '8');
  form.append('waterfallxapp', 'comet');
  form.append('farr', { uri: file.uri, name: file.name, type: file.type ?? 'image/jpeg' } as unknown as Blob);
  form.append('upload_id', rnd(10));
  form.append('fb_dtsg', dtsg);
  const { data } = await instance.post<string>(
    `https://upload-business.facebook.com/ajax/react_composer/attachments/photo/upload?av=${pageId}&__a=1&fb_dtsg=${encodeURIComponent(dtsg)}`,
    form,
    TEXT,
  );
  const photoId = parse(data)?.payload?.photoID;
  if (!photoId) throw new Error(tr('stories.err.photo'));
  return String(photoId);
}

/** Upload video Story (khởi tạo → gửi file → xác nhận → encode) → video_id. */
export async function uploadStoryVideo(dtsg: string, fbId: string, pageId: string, file: LocalFile): Promise<string> {
  const size = file.size;
  if (!size) throw new Error(tr('gp.err.videoSize'));
  const waterfallId = Crypto.randomUUID();

  // B1: khởi tạo → video_id
  const init = new FormData();
  const fields: Record<string, string> = {
    partition_start_offset: '0', file_size: String(size), partition_end_offset: String(size), file_extension: 'mp4', target_id: pageId,
    creator_product: '2', source: 'composer', waterfall_id: waterfallId, composer_entry_point_ref: 'biz_web_content_manager_published_posts',
    has_file_been_replaced: 'false', spherical: 'false', supports_file_api: 'true', supports_chunking: 'true', __a: '1', __user: fbId, fb_dtsg: dtsg,
  };
  Object.entries(fields).forEach(([k, v]) => init.append(k, v));
  const { data: initData } = await instance.post<string>(`https://business.facebook.com/ajax/video/upload/requests/start/?av=${pageId}&__a=1`, init, TEXT);
  const videoId = parse(initData)?.payload?.video_id;
  if (!videoId) throw new Error(tr('gp.err.videoId'));

  // B2: gửi nội dung file
  const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.MD5, String(videoId));
  const type = file.type ?? 'video/mp4';
  const { data: up } = await instance.post<string>(
    `https://rupload-hkg4-2.up.facebook.com/fb_video/${hash}-0-${size}?__user=${fbId}&__a=1&fb_dtsg=${encodeURIComponent(dtsg)}`,
    fileBody(file.uri, { type }),
    {
      ...TEXT,
      headers: {
        accept: '*/*', 'content-type': type, 'x-entity-length': String(size), 'x-entity-name': `${pageId}_${videoId}.mp4`, 'x-entity-type': type,
        offset: '0', start_offset: '0', end_offset: String(size), product_media_id: String(videoId),
      },
      timeout: 600_000,
    },
  );
  const upHash = parse(up)?.h;
  if (!upHash) throw new Error(tr('gp.err.videoHash'));

  // B3: xác nhận
  const confirm = new FormData();
  confirm.append('fbuploader_video_file_chunk', upHash);
  const q = new URLSearchParams({
    av: pageId, video_id: String(videoId), start_offset: '0', end_offset: String(size), source: 'composer', target_id: pageId, waterfall_id: waterfallId,
    composer_entry_point_ref: 'biz_web_content_manager_published_posts', has_file_been_replaced: 'false', supports_chunking: 'true',
    partition_start_offset: '0', partition_end_offset: String(size), __a: '1', __user: fbId, fb_dtsg: dtsg,
  });
  await instance.post(`https://business.facebook.com/ajax/video/upload/requests/receive/?${q.toString()}`, confirm, TEXT);

  // B4: encode
  const enc = new FormData();
  enc.append('av', pageId);
  enc.append('__a', '1');
  enc.append('__user', fbId);
  enc.append('fb_dtsg', dtsg);
  enc.append('variables', JSON.stringify({ input: { client_mutation_id: mutationId(), video_id: String(videoId), actor_id: pageId, source: 'biz_composer' } }));
  enc.append('server_timestamps', 'true');
  enc.append('doc_id', '6230865220357002');
  await instance.post('https://business.facebook.com/api/graphql', enc, TEXT);
  return String(videoId);
}

/** Attachment Story (ảnh hoặc video), kèm nút "Xem thêm" nếu có link. */
export function storyAttachment(kind: 'photo' | 'video', id: string, link?: string) {
  return {
    [kind]: {
      id,
      story_call_to_action_data: link ? { type: 'SEE_MORE', link, is_cta_share_post: true, link_title: 'Xem thêm' } : null,
      overlays: [],
    },
  };
}

/** Tạo Story (đăng ngay hoặc hẹn giờ — unix giây). */
export async function publishStory(dtsg: string, fbId: string, pageId: string, attachments: unknown[], scheduledUnix?: number): Promise<void> {
  const unpublished = scheduledUnix ? { scheduled_publish_time: scheduledUnix, unpublished_content_type: 'SCHEDULED' } : null;
  const variables = {
    input: {
      client_mutation_id: mutationId(),
      base: { actor_id: pageId, composer_entry_point: 'biz_web_home_stories', source: 'WWW', unpublished_content_data: unpublished, attachments },
      channels: ['FACEBOOK_STORY'],
      identities: [pageId],
    },
    checkPhotosToReelsUpsellEligibility: false,
  };
  const form = new FormData();
  const fields: Record<string, string> = {
    av: pageId, __a: '1', __user: fbId, __comet_req: '0', fb_dtsg: dtsg, fb_api_caller_class: 'RelayModern',
    variables: JSON.stringify(variables), server_timestamps: 'true', doc_id: '7824581757552022',
  };
  Object.entries(fields).forEach(([k, v]) => form.append(k, v));
  const { data } = await instance.post<string>('https://business.facebook.com/api/graphql', form, TEXT);
  const json = parse(data);
  if (!json?.data?.xfamily_content_create?.content_creation_flags) {
    throw new Error(json?.errors?.[0]?.message ?? tr('stories.err.publish'));
  }
}
