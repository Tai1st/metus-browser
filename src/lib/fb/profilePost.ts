// Dịch vụ "Đăng bài lên Trang cá nhân" — port từ metus-few services/facebook/Timeline.ts
// (đăng bài qua actor_id = chính người dùng, khác UpToPics/Group vốn đăng dưới
// danh nghĩa Page/Nhóm). Upload ảnh/video + nền chữ dùng lại hàm đã có trong
// Group.ts (uploadGroupImage/uploadGroupVideo/getTextFormatPresets đều generic,
// không cần pageId là tự động đăng với tư cách cá nhân).
import { graphql, uuid } from './Group';
import { tr } from '../i18n';

export interface CreateProfilePostParams {
  dtsg: string;
  fbId: string;
  text: string;
  photoIds?: string[];
  /** Có video thì bỏ qua photoIds (video/ảnh loại trừ nhau, giống bản gốc). */
  videoId?: string;
  textFormatPresetId?: string;
  reshareToStory?: boolean;
  /** Đăng kèm vào các nhóm khác (cross-post). */
  groupIds?: string[];
}

/** Tạo bài trên trang cá nhân (mutation ComposerStoryCreateMutation, actor_id = fbId) → postId. */
export async function createProfilePost(p: CreateProfilePostParams): Promise<{ postId: string | null }> {
  const mediaAttachments = p.videoId ? [{ video: { id: p.videoId } }] : (p.photoIds ?? []).map((id) => ({ photo: { id } }));

  const input: any = {
    composer_entry_point: 'inline_composer',
    composer_source_surface: 'timeline',
    source: 'WWW',
    idempotence_token: `${uuid()}_FEED`,
    attachments: mediaAttachments,
    audience: { privacy: { allow: [], base_state: 'EVERYONE', deny: [], tag_expansion_state: 'UNSPECIFIED' } },
    message: { ranges: [], text: p.text },
    with_tags_ids: null,
    inline_activities: [],
    text_format_preset_id: p.textFormatPresetId || '0',
    ai_generated_self_disclosure_metadata: { was_self_disclosed_as_ai_generated: false },
    publishing_flow: { supported_flows: ['ASYNC_SILENT', 'ASYNC_NOTIF', 'FALLBACK'] },
    post_publish_story_data: { reshare_post_as_sticker: p.reshareToStory ? 'ENABLED' : 'DISABLED' },
    logging: { composer_session_id: uuid() },
    tracking: [null],
    event_share_metadata: { surface: 'newsfeed' },
    actor_id: p.fbId,
    client_mutation_id: '1',
  };
  if (p.groupIds?.length) input.groups_schedule_xposting = p.groupIds.map((to_id) => ({ xpost_audience: { to_id } }));

  const variables = {
    input,
    feedLocation: 'TIMELINE',
    feedbackSource: 0,
    focusCommentID: null,
    gridMediaWidth: 230,
    groupID: null,
    scale: 1,
    privacySelectorRenderLocation: 'COMET_STREAM',
    checkPhotosToReelsUpsellEligibility: true,
    referringStoryRenderLocation: null,
    renderLocation: 'timeline',
    useDefaultActor: false,
    isFeed: false,
    isFundraiser: false,
    isFunFactPost: false,
    isGroup: false,
    isEvent: false,
    isTimeline: true,
    isSocialLearning: false,
    isPageNewsFeed: false,
    isProfileReviews: false,
    isWorkSharedDraft: false,
  };

  const form = new FormData();
  form.append('av', p.fbId);
  form.append('__user', p.fbId);
  form.append('__a', '1');
  form.append('__comet_req', '15');
  form.append('fb_dtsg', p.dtsg);
  form.append('fb_api_caller_class', 'RelayModern');
  form.append('fb_api_req_friendly_name', 'ComposerStoryCreateMutation');
  form.append('variables', JSON.stringify(variables));
  form.append('server_timestamps', 'true');
  form.append('doc_id', '27651493101172267');

  const json = await graphql(form);
  const sc = json?.data?.story_create;
  const postId: string | null = sc?.post_id ?? null;
  if (!postId) throw new Error(json?.errors?.[0]?.message ?? tr('gp.err.create'));
  return { postId };
}

const LIKE_REACTION_ID = '1635855486666999';

/** Like bài vừa đăng bằng chính tài khoản đã đăng (mutation CometUFIFeedbackReactMutation). */
export async function likeProfilePost(dtsg: string, fbId: string, postId: string): Promise<void> {
  const feedbackId = btoa(`feedback:${postId}`);
  const variables = {
    input: {
      feedback_id: feedbackId,
      feedback_reaction_id: LIKE_REACTION_ID,
      feedback_source: 'NEWS_FEED',
      is_tracking_encrypted: false,
      tracking: [],
      actor_id: fbId,
      client_mutation_id: '1',
    },
    scale: 1,
    useDefaultActor: false,
  };
  const form = new FormData();
  form.append('av', fbId);
  form.append('__user', fbId);
  form.append('__a', '1');
  form.append('fb_dtsg', dtsg);
  form.append('server_timestamps', 'true');
  form.append('fb_api_caller_class', 'RelayModern');
  form.append('fb_api_req_friendly_name', 'CometUFIFeedbackReactMutation');
  form.append('variables', JSON.stringify(variables));
  form.append('doc_id', '27646120298312844');
  await graphql(form);
}
