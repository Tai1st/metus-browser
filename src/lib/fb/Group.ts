/**
 * Đăng bài lên nhóm Facebook. Port từ metus-few: services/facebook/Group.ts
 * (Group.createPost) — giữ nguyên payload GraphQL đã kiểm chứng thực tế, chỉ
 * đổi nguồn fbId và transport (compat.instance chạy trên native HTTP).
 *
 * v1: đăng văn bản (attachments rỗng), hỗ trợ đăng nhiều nhóm và hẹn giờ.
 */
import * as Crypto from 'expo-crypto';

import { instance } from './compat';
import * as storage from '../storage';

export interface CreateGroupPostParams {
  dtsg: string;
  groupId: string;
  text: string;
  attachments?: unknown[];
  /** Đăng kèm vào các nhóm khác (cross-post). */
  groupIds?: string[];
  /** Hẹn giờ đăng (unix seconds). */
  scheduledPublishTime?: number;
}

export interface CreateGroupPostResult {
  success: boolean;
  postId?: string;
  error?: string;
  raw?: any;
}

function uuid(): string {
  return Crypto.randomUUID();
}

export async function createGroupPost(params: CreateGroupPostParams): Promise<CreateGroupPostResult> {
  const fbAccount = storage.get<{ id: string }>(storage.StorageKey.FB_ACCOUNT);
  const fbId = fbAccount?.id ?? '';
  const effectiveId = fbId;

  const formData = new FormData();
  formData.append('av', effectiveId);
  formData.append('__user', fbId);
  formData.append('__a', '1');
  formData.append('__comet_req', '0');
  formData.append('fb_api_caller_class', 'RelayModern');
  formData.append('fb_api_req_friendly_name', 'ComposerStoryCreateMutation');
  formData.append('server_timestamps', 'true');

  const groupIds = (params.groupIds ?? []).filter((id) => id && id !== params.groupId);

  const input: any = {
    composer_entry_point: 'inline_composer',
    composer_source_surface: 'group',
    composer_type: 'group',
    logging: { composer_session_id: uuid() },
    source: 'WWW',
    message: { ranges: [], text: params.text },
    with_tags_ids: null,
    inline_activities: [],
    attachments: params.attachments ?? [],
    composed_text: {
      block_data: ['{}'],
      block_depths: [0],
      block_types: [0],
      blocks: [params.text],
      entities: ['[]'],
      entity_map: '{}',
      inline_styles: ['[]'],
    },
    event_share_metadata: { surface: 'newsfeed' },
    audience: { to_id: params.groupId },
    actor_id: effectiveId,
    client_mutation_id: '1',
    group_flair: { flair_id: null },
  };

  if (groupIds.length > 0) {
    input.groups_schedule_xposting = groupIds.map((to_id) => ({ xpost_audience: { to_id } }));
  }
  if (params.scheduledPublishTime) {
    input.unpublished_content_data = {
      scheduled_publish_time: params.scheduledPublishTime,
      unpublished_content_type: 'SCHEDULED',
    };
  }

  const variables = {
    input,
    feedLocation: 'GROUP',
    feedbackSource: 0,
    focusCommentID: null,
    gridMediaWidth: null,
    groupID: null,
    scale: 1,
    privacySelectorRenderLocation: 'COMET_STREAM',
    checkPhotosToReelsUpsellEligibility: false,
    renderLocation: 'group',
    useDefaultActor: false,
    inviteShortLinkKey: null,
    isFeed: false,
    isFundraiser: false,
    isFunFactPost: false,
    isGroup: true,
    isEvent: false,
    isTimeline: false,
    isSocialLearning: false,
    isPageNewsFeed: false,
    isProfileReviews: false,
    isWorkSharedDraft: false,
    hashtag: null,
    canUserManageOffers: false,
  };

  // doc_id mode 'normal' (hỗ trợ groups_schedule_xposting).
  formData.append('fb_dtsg', params.dtsg);
  formData.append('variables', JSON.stringify(variables));
  formData.append('doc_id', '28073130205639175');

  try {
    const { data } = await instance.post<string>('https://www.facebook.com/api/graphql?metuscors=0', formData, {
      headers: { origin: 'https://www.facebook.com', referer: 'https://www.facebook.com/' },
      responseType: 'text',
      transformResponse: (r) => r,
    });
    const raw = typeof data === 'string' ? data : JSON.stringify(data);
    const firstLine = raw.split('\n')[0].replace(/^for \(;;\);/, '');
    const json = JSON.parse(firstLine);
    if (json?.errors?.length) {
      return { success: false, error: json.errors[0]?.message ?? 'Facebook trả lỗi', raw: json };
    }
    const postId =
      json?.data?.story_create?.story?.legacy_story_hideable_id ??
      json?.data?.story_create?.story?.id ??
      json?.data?.story_create?.group_post?.id;
    return { success: !!json?.data, postId, raw: json };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
