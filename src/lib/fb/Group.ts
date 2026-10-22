/**
 * API nhóm Facebook cho tool "Đăng bài nhóm". Port từ metus-few
 * services/facebook/Group.ts (+ Comment.create) — giữ nguyên payload GraphQL đã
 * kiểm chứng thực tế, chỉ đổi transport (compat.instance chạy native HTTP) và
 * nhận fbId qua tham số thay vì đọc storage.
 */
import { fileBody } from '@metus/http';
import * as Crypto from 'expo-crypto';

import { exFetch, instance } from './compat';
import { tr } from '../i18n';

const GRAPHQL = 'https://www.facebook.com/api/graphql?metuscors=0';

const uuid = () => Crypto.randomUUID();

/** File chọn từ máy (DocumentPicker). */
export interface LocalFile {
  uri: string;
  name: string;
  type?: string;
  size?: number;
}

/** Bỏ tiền tố "for (;;);" và lấy dòng JSON đầu (GraphQL có thể stream nhiều dòng). */
function parseFbJson(data: unknown): any {
  if (typeof data !== 'string') return data;
  const first = data.replace(/^for \(;;\);/, '').split('\n')[0];
  return JSON.parse(first);
}

/** pageId → request mang cookie i_user=<pageId> (hành động dưới danh nghĩa Page). */
async function graphql(form: FormData, pageId?: string): Promise<any> {
  const { data } = await instance.post<string>(GRAPHQL, form, {
    iUser: pageId,
    headers: { origin: 'https://www.facebook.com', referer: 'https://www.facebook.com/' },
    responseType: 'text',
    transformResponse: (r) => r,
  });
  const json = parseFbJson(data);
  if (json?.errors?.length && !json?.data) throw new Error(json.errors[0]?.message ?? tr('gp.err.facebook'));
  return json;
}

// ───────────────────────────── Danh sách nhóm ─────────────────────────────

export interface GroupItem {
  id: string;
  name: string;
  picture?: string;
  isAdmin: boolean;
}

/** Nhóm của user (admin + thành viên) — useGetGroups của metus-few. Có pageId → nhóm của Page (i_user). */
export async function getGroups(dtsg: string, fbId: string, pageId?: string): Promise<GroupItem[]> {
  const form = new FormData();
  form.append('fb_dtsg', dtsg);
  form.append('av', pageId || fbId);
  form.append('variables', JSON.stringify({ adminGroupsCount: 90, memberGroupsCount: 1000, scale: 1.5, count: 10, cursor: null }));
  form.append('doc_id', '3884641628300421');
  const json = await graphql(form, pageId);
  const map = (edges: any[] | undefined, isAdmin: boolean): GroupItem[] =>
    (edges ?? []).map((e) => ({
      id: String(e?.node?.id),
      name: String(e?.node?.name ?? ''),
      picture: e?.node?.profile_picture?.uri,
      isAdmin,
    }));
  const admin = map(json?.data?.adminGroups?.groups_tab?.tab_groups_list?.edges, true);
  const member = map(json?.data?.nonAdminGroups?.groups_tab?.tab_groups_list?.edges, false);
  const seen = new Set<string>();
  return [...admin, ...member].filter((g) => g.id && !seen.has(g.id) && seen.add(g.id));
}

export interface PageProfile {
  /** ID hồ sơ của Page — dùng cho i_user / av khi hành động dưới danh nghĩa Page. */
  profileId: string;
  /** ID Page kiểu Graph (delegate_page_id), có thể rỗng. */
  pageId?: string;
  name: string;
  picture?: string;
}

const unescapeJson = (v: string) => {
  try {
    return JSON.parse(`"${v}"`) as string;
  } catch {
    return v;
  }
};

/**
 * Page mà tài khoản quản lý, kèm ID hồ sơ (Page trải nghiệm mới). Đọc JSON
 * `additional_profiles_with_biz_tools` nhúng sẵn trong trang "Trang của bạn".
 */
export async function getPageProfiles(): Promise<PageProfile[]> {
  const { data } = await instance.get<string>('https://www.facebook.com/pages/?category=your_pages&ref=bookmarks', {
    responseType: 'text',
    transformResponse: (r) => r,
    headers: { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
  });
  const html = String(data);
  const out = new Map<string, PageProfile>();
  const re = /"delegate_page_id":"(\d+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const chunk = html.slice(m.index, m.index + 2500);
    const profileId =
      chunk.match(/"if_viewer_can_login_as_profile_plus":\{"__typename":"User","id":"(\d+)"/)?.[1] ??
      chunk.match(/\},"id":"(\d+)","name":"/)?.[1];
    if (!profileId) continue;
    const name = unescapeJson(chunk.match(/"id":"\d+","name":"((?:[^"\\]|\\.)*)"/)?.[1] ?? profileId);
    const pic = chunk.match(/"profile_picture":\{"uri":"((?:[^"\\]|\\.)*)"/)?.[1];
    out.set(profileId, { profileId, pageId: m[1], name, picture: pic ? unescapeJson(pic) : undefined });
  }
  // Hồ sơ chuyển đổi được nhưng không có delegate (profile_switcher_eligible_profiles)
  const sw = html.match(/"profile_switcher_eligible_profiles":\{"nodes":(\[.*?\])\}/)?.[1];
  if (sw) {
    try {
      for (const n of JSON.parse(sw) as { profile?: { id?: string; name?: string } }[]) {
        const id = n.profile?.id;
        if (id && !out.has(id)) out.set(id, { profileId: id, name: n.profile?.name ?? id });
      }
    } catch {
      // bỏ qua
    }
  }
  return [...out.values()];
}

/** Thông tin 1 nhóm theo ID (cho nhóm nhập tay). */
export async function getGroupInfo(dtsg: string, fbId: string, groupId: string, pageId?: string): Promise<GroupItem> {
  const form = new FormData();
  form.append('fb_dtsg', dtsg);
  form.append('av', pageId || fbId);
  form.append('variables', JSON.stringify({ actionBarRenderLocation: 'WWW_COMET_HOVERCARD', context: 'DEFAULT', entityID: groupId, scale: 2 }));
  form.append('doc_id', '27838033792508877');
  const json = await graphql(form, pageId);
  const node = json?.data?.node;
  if (node?.__typename !== 'Group') throw new Error(tr('gp.err.notGroup'));
  const g = node.comet_hovercard_renderer?.group ?? {};
  return { id: String(g.id ?? groupId), name: String(g.name ?? groupId), picture: g.profile_picture?.uri, isAdmin: false };
}

// ───────────────────────────── Đính kèm ─────────────────────────────

/** Preview link → share_scrape_data để gắn link vào bài. */
export interface LinkPreview {
  scrapeStr: string;
  title: string;
  image: string;
}

export async function getLinkPreview(dtsg: string, fbId: string, link: string, pageId?: string): Promise<LinkPreview> {
  const form = new FormData();
  form.append('fb_dtsg', dtsg);
  form.append('av', pageId || fbId);
  form.append('server_timestamps', 'true');
  form.append('doc_id', '5012066348923062');
  form.append(
    'variables',
    JSON.stringify({
      feedLocation: 'FEED_COMPOSER',
      params: { url: link },
      privacySelectorRenderLocation: 'COMET_COMPOSER',
      renderLocation: 'composer_preview',
      scale: 1,
      useDefaultActor: false,
      shouldIncludeStoryAttachment: false,
      __relay_internal__pv__FBReelsEnableDeferrelayprovider: true,
    }),
  );
  const json = await graphql(form, pageId);
  const lp = json?.data?.link_preview;
  const scrapeStr: string = lp?.share_scrape_data ?? '';
  let title = '';
  let image = '';
  // Lấy tiêu đề/ảnh theo share_type giống metus-few (22: bài Facebook, 100: link ngoài)
  try {
    const type = scrapeStr ? JSON.parse(scrapeStr)?.share_type : null;
    if (type === 22) {
      const st = lp?.story?.comet_sections?.attached_story_layout?.story;
      title = st?.message?.text ?? '';
      const media = st?.attachments?.[0]?.styles?.attachment?.media;
      image = media?.photo_image?.uri ?? media?.card_image?.uri ?? '';
    } else if (type === 100) {
      const att = lp?.story_attachment?.styles?.attachment;
      title = att?.title_with_entities?.text ?? '';
      image = att?.media?.photo_image?.uri ?? att?.media?.card_image?.uri ?? '';
    }
  } catch {
    // giữ rỗng
  }
  return { scrapeStr, title, image };
}

/** Upload ảnh cho bài nhóm → photoID. */
export async function uploadGroupImage(p: { dtsg: string; fbId: string; file: LocalFile; pageId?: string }): Promise<string> {
  const form = new FormData();
  form.append('fb_dtsg', p.dtsg);
  form.append('profile_id', p.fbId);
  form.append('source', '8');
  form.append('farr', { uri: p.file.uri, name: p.file.name, type: p.file.type ?? 'image/jpeg' } as unknown as Blob);
  form.append('waterfallxapp', 'comet');
  form.append('upload_id', 'jsc_c_9');
  const { data } = await instance.post<string>('https://upload.facebook.com/ajax/react_composer/attachments/photo/upload?metuscors=0', form, {
    params: { av: p.pageId || p.fbId, __user: p.fbId, __a: 1, fb_dtsg: p.dtsg },
    iUser: p.pageId,
    responseType: 'text',
    transformResponse: (r) => r,
  });
  const photoId = parseFbJson(data)?.payload?.photoID;
  if (!photoId) throw new Error(tr('gp.err.photo'));
  return String(photoId);
}

/** Upload video cho bài nhóm (resumable upload của Facebook) → video_id. */
export async function uploadGroupVideo(p: { dtsg: string; fbId: string; file: LocalFile; pageId?: string }): Promise<string> {
  const target = p.pageId || p.fbId;
  const size = p.file.size;
  if (!size) throw new Error(tr('gp.err.videoSize'));

  const initForm = new FormData();
  initForm.append('fb_dtsg', p.dtsg);
  initForm.append('__user', p.fbId);
  initForm.append('__a', '1');
  const { data: initData } = await instance.post<string>('https://business.facebook.com/video/composer/init_upload?metuscors=0', initForm, {
    params: {
      target_id: target,
      composer_entry_point_ref: 'cs_global_upload_reel',
      video_publisher_action_source: JSON.stringify({ product: 'creator_studio', feature: 'cs_reel_composer', entry_point: 'cs_global_upload_reel' }),
      av: target,
    },
    iUser: p.pageId,
    responseType: 'text',
    transformResponse: (r) => r,
  });
  const service = parseFbJson(initData)?.payload?.videoUploader?.[0]?.resumable_service_name;
  if (!service) throw new Error(tr('gp.err.videoInit'));

  const waterfallId = uuid();
  const startForm = new FormData();
  const startFields: Record<string, string> = {
    fb_dtsg: p.dtsg, av: target, server_timestamps: 'true', waterfall_id: waterfallId, __comet_req: '11', target_id: target,
    source: 'composer', composer_entry_point_ref: 'group', dpr: '1.5', supports_chunking: 'true', supports_file_api: 'true',
    has_file_been_replaced: 'false', file_size: String(size), file_extension: 'mp4', partition_start_offset: '0',
    partition_end_offset: String(size), jazoest: '25470', __a: '1', __user: p.fbId,
  };
  Object.entries(startFields).forEach(([k, v]) => startForm.append(k, v));
  const { data: startData } = await instance.post<string>(`https://business.facebook.com/ajax/video/upload/requests/start/?av=${target}&__a=1`, startForm, {
    iUser: p.pageId,
    responseType: 'text',
    transformResponse: (r) => r,
  });
  const videoId = parseFbJson(startData)?.payload?.video_id;
  if (!videoId) throw new Error(tr('gp.err.videoId'));

  const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.MD5, String(videoId));
  const uploadUrl = `https://${service}.facebook.com/fb_video/${hash}-0-${size}?metus_latest&__user=${p.fbId}&__a=1&fb_dtsg=${encodeURIComponent(p.dtsg)}`;
  await instance.get(uploadUrl, { responseType: 'text', iUser: p.pageId });
  const { data: up } = await instance.post<any>(uploadUrl, fileBody(p.file.uri, { type: 'video/mp4' }), {
    params: { video_id: videoId },
    iUser: p.pageId,
    headers: {
      accept: '*/*',
      'x-entity-length': String(size),
      'x-entity-name': `${target}_${videoId}.mp4`,
      'x-entity-type': 'video/mp4',
      offset: '0',
      start_offset: '0',
      end_offset: String(size),
      product_media_id: String(videoId),
      'Content-Type': 'video/mp4',
    },
    timeout: 600_000,
  });
  const upHash = (typeof up === 'string' ? JSON.parse(up) : up)?.h;
  if (!upHash) throw new Error(tr('gp.err.videoHash'));

  const receive = new URLSearchParams({
    waterfall_id: waterfallId, target_id: target, video_id: String(videoId), source: 'composer', composer_entry_point_ref: 'group',
    supports_chunking: 'true', supports_upload_service: 'true', partition_start_offset: '0', partition_end_offset: String(size),
    start_offset: '0', end_offset: String(size), fbuploader_video_file_chunk: upHash, has_file_been_replaced: 'false',
    __user: p.fbId, __a: '1', fb_dtsg: p.dtsg, __comet_req: '11',
  });
  await instance.post('https://business.facebook.com/ajax/video/upload/requests/receive?metus_latest', receive, {
    params: { av: target, __a: '1' },
    iUser: p.pageId,
    responseType: 'text',
  });
  return String(videoId);
}

// ───────────────────────────── Ẩn danh / nền chữ ─────────────────────────────

/** ID tác giả ẩn danh của user trong nhóm (null nếu nhóm không bật ẩn danh). */
export async function getAnonymousProfileId(dtsg: string, fbId: string, groupId: string): Promise<string | null> {
  const form = new FormData();
  const fields: Record<string, string> = {
    av: fbId, __user: fbId, __a: '1', __comet_req: '0', fb_dtsg: dtsg, fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: 'CometGroupDiscussionRootSuccessQuery', server_timestamps: 'true', doc_id: '25274469595580898',
  };
  Object.entries(fields).forEach(([k, v]) => form.append(k, v));
  form.append(
    'variables',
    JSON.stringify({
      creative_provider_id: null, feedLocation: 'GROUP', feedbackSource: 0, focusCommentID: null, feedType: 'DISCUSSION', scale: 1,
      sortingSetting: 'CHRONOLOGICAL', filter_topic_id: null, useDefaultActor: false, groupID: groupId, hoistStories: [], hoistStoriesCount: 0,
      hoistedSectionHeaderType: 'notifications', hasHoistStories: false, privacySelectorRenderLocation: 'COMET_STREAM', renderLocation: 'group',
      regular_stories_count: 1, regular_stories_stream_initial_count: 1, regular_stories_cursor: null, shouldDeferMainFeed: false, threadID: '',
      autoOpenChat: false, autoCreateChatDialog: false,
      __relay_internal__pv__GroupsCometLazyLoadFeaturedSectionrelayprovider: false,
      __relay_internal__pv__IsWorkUserrelayprovider: false,
      __relay_internal__pv__GroupsCometGYSJFeedItemHeightrelayprovider: 206,
    }),
  );
  const json = await graphql(form);
  return json?.data?.group?.comet_inline_composer_renderer?.group?.available_actors?.edges?.[0]?.node?.id ?? null;
}

export interface TextFormatPreset {
  id: string;
  /** Màu nền chính (#rrggbb). */
  color: string;
  /** Ảnh nền thật (nền dạng ảnh). */
  image?: string;
  /** Ảnh thu nhỏ Facebook tạo sẵn (dùng hiển thị cả nền gradient). */
  thumb?: string;
  description?: string;
}

export interface TextFormatPresetData {
  ranked: TextFormatPreset[];
  categories: { name: string; presets: TextFormatPreset[] }[];
}

/** Màu Facebook dạng AARRGGBB → #rrggbb (fbColorToHex của metus-few). */
const fbColorToHex = (c?: string | null) => (!c || c.length < 8 ? '#ffffff' : `#${c.slice(2)}`);

const toPreset = (item: any): TextFormatPreset | null => {
  const p = item?.preset ?? item;
  if (!p?.preset_id) return null;
  return {
    id: String(p.preset_id),
    color: fbColorToHex(p.background_color),
    image: p.background?.image?.uri ?? undefined,
    thumb: p.default_thumbnail?.uri ?? p.custom_thumbnail?.uri ?? undefined,
    description: p.background_description ?? undefined,
  };
};

/** Nền chữ (text format preset) của Facebook: nhóm "dùng nhiều" + các danh mục. */
export async function getTextFormatPresets(dtsg: string, fbId: string, pageId?: string): Promise<TextFormatPresetData> {
  const form = new FormData();
  form.append('fb_dtsg', dtsg);
  form.append('av', pageId || fbId);
  form.append('__user', fbId);
  form.append('__a', '1');
  form.append('server_timestamps', 'true');
  form.append('variables', JSON.stringify({ containsCustomSwatchCategory: false, scale: 2 }));
  form.append('doc_id', '9987157514675970');
  const json = await graphql(form, pageId);
  const viewer = json?.data?.viewer ?? {};
  const list = (arr: any[] | undefined) => (arr ?? []).map(toPreset).filter((x): x is TextFormatPreset => !!x);
  return {
    ranked: list(viewer.ranked_composer_text_format_presets),
    categories: ((viewer.categorized_text_format_presets ?? []) as any[])
      .map((c) => ({ name: String(c?.name ?? ''), presets: list(c?.ranked_text_format_presets) }))
      .filter((c) => c.presets.length),
  };
}

// ───────────────────────────── Đăng bài / bình luận ─────────────────────────────

export interface CreateGroupPostParams {
  dtsg: string;
  fbId: string;
  groupId: string;
  text: string;
  attachments?: unknown[];
  mode?: 'normal' | 'anonymous';
  anonymousProfileId?: string;
  /** Đăng với tư cách Page. */
  pageId?: string;
  textFormatPresetId?: string;
  /** Đăng kèm vào các nhóm khác (cross-post, chỉ mode normal). */
  groupIds?: string[];
  /** Hẹn giờ đăng native của Facebook (unix seconds). */
  scheduledPublishTime?: number;
}

/** Tạo bài trong nhóm → postId (rỗng nếu bài hẹn giờ/chờ duyệt). */
export async function createGroupPost(p: CreateGroupPostParams): Promise<{ postId: string | null }> {
  const isAnonymous = p.mode === 'anonymous' && !!p.anonymousProfileId;
  const isPage = !!p.pageId && !isAnonymous;
  const actorId = isPage ? p.pageId! : isAnonymous ? p.anonymousProfileId! : p.fbId;

  const form = new FormData();
  const fields: Record<string, string> = {
    av: actorId, __user: p.fbId, __a: '1', __comet_req: '0', fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: 'ComposerStoryCreateMutation', server_timestamps: 'true',
  };
  Object.entries(fields).forEach(([k, v]) => form.append(k, v));

  const input: any = {
    composer_entry_point: isAnonymous ? 'publisher_bar_anonymous_author' : isPage ? 'publisher_bar' : 'inline_composer',
    composer_source_surface: 'group',
    composer_type: 'group',
    logging: { composer_session_id: uuid() },
    source: 'WWW',
    message: { ranges: [], text: p.text },
    with_tags_ids: null,
    inline_activities: [],
    attachments: p.attachments ?? [],
    composed_text: {
      block_data: ['{}'], block_depths: [0], block_types: [0], blocks: [p.text], entities: ['[]'], entity_map: '{}', inline_styles: ['[]'],
    },
    event_share_metadata: { surface: 'newsfeed' },
    audience: { to_id: p.groupId },
    actor_id: actorId,
    client_mutation_id: '1',
    group_flair: { flair_id: null },
  };
  if (isAnonymous) input.ask_admin_to_post_for_user = { is_asking_admin_to_post: true };
  const xpost = (p.groupIds ?? []).filter((id) => id && id !== p.groupId);
  if (!isAnonymous && xpost.length) input.groups_schedule_xposting = xpost.map((to_id) => ({ xpost_audience: { to_id } }));
  if (p.scheduledPublishTime) {
    input.unpublished_content_data = { scheduled_publish_time: p.scheduledPublishTime, unpublished_content_type: 'SCHEDULED' };
  }
  if (p.textFormatPresetId) input.text_format_preset_id = p.textFormatPresetId;

  form.append('fb_dtsg', p.dtsg);
  form.append(
    'variables',
    JSON.stringify({
      input, feedLocation: 'GROUP', feedbackSource: 0, focusCommentID: null, gridMediaWidth: null, groupID: null, scale: 1,
      privacySelectorRenderLocation: 'COMET_STREAM', checkPhotosToReelsUpsellEligibility: false, renderLocation: 'group', useDefaultActor: false,
      inviteShortLinkKey: null, isFeed: false, isFundraiser: false, isFunFactPost: false, isGroup: true, isEvent: false, isTimeline: false,
      isSocialLearning: false, isPageNewsFeed: false, isProfileReviews: false, isWorkSharedDraft: false, hashtag: null, canUserManageOffers: false,
    }),
  );
  form.append('doc_id', isAnonymous ? '32972562495725502' : '28073130205639175');

  const json = await graphql(form, isPage ? p.pageId : undefined);
  const sc = json?.data?.story_create;
  if (!sc) throw new Error(json?.errors?.[0]?.message ?? tr('gp.err.create'));
  // story id dạng base64 "S:_I<actor>:VK:<postId>" (metus-few) — bài hẹn giờ/chờ duyệt có thể không có
  let postId: string | null = null;
  try {
    const raw = sc?.story?.id || sc?.story_id;
    if (raw) postId = atob(raw).split(':VK:')[1] || null;
  } catch {
    postId = null;
  }
  return { postId };
}

/** Bình luận vào bài (Comment.create của metus-few) → url bình luận. */
export interface CommentRange {
  entity: { id: string };
  length: number;
  offset: number;
}

/** Bình luận đầy đủ (tag, ảnh) → url + legacy_token (để sửa bình luận). */
export async function postComment(p: {
  dtsg: string; fbId: string; postId: string; text: string; pageId?: string; photo?: LocalFile | null; ranges?: CommentRange[];
}): Promise<{ url: string | null; legacyToken: string | null; attachments: unknown }> {
  const actor = p.pageId || p.fbId;
  const attachments = p.photo ? [{ media: { id: await uploadGroupImage({ dtsg: p.dtsg, fbId: p.fbId, file: p.photo, pageId: p.pageId }) } }] : null;
  const form = new FormData();
  form.append('fb_dtsg', p.dtsg);
  form.append('av', actor);
  form.append(
    'variables',
    JSON.stringify({
      displayCommentsFeedbackContext: null, displayCommentsContextEnableComment: null, displayCommentsContextIsAdPreview: null,
      displayCommentsContextIsAggregatedShare: null, displayCommentsContextIsStorySet: null, feedLocation: 'GROUP', feedbackSource: 0,
      focusCommentID: null, groupID: null, includeNestedComments: false,
      input: {
        attachments, feedback_id: btoa(`feedback:${p.postId}`), formatting_style: null, message: { ranges: p.ranges ?? [], text: p.text },
        reply_target_clicked: false, feedback_source: 'PROFILE', actor_id: actor, client_mutation_id: '18',
      },
      inviteShortLinkKey: null, renderLocation: null, scale: 1, useDefaultActor: false,
      UFI2CommentsProvider_commentsKey: 'CometGroupDiscussionRootSuccessQuery',
      __relay_internal__pv__GroupsCometDelayCheckBlockedUsersrelayprovider: false,
    }),
  );
  form.append('doc_id', '3988300734617853');
  const json = await graphql(form, p.pageId);
  const node = json?.data?.comment_create?.feedback_comment_edge?.node;
  if (!node) throw new Error(json?.errors?.[0]?.message ?? tr('gp.err.comment'));
  return { url: node.url ?? null, legacyToken: node.legacy_token ?? null, attachments };
}

/** Sửa bình luận (Comment.edit của metus-few) — dùng cho "Lách bộ lọc của admin". */
export async function editComment(p: {
  dtsg: string; fbId: string; legacyToken: string; text: string; attachments: unknown; ranges?: CommentRange[]; pageId?: string;
}): Promise<void> {
  const actor = p.pageId || p.fbId;
  const form = new FormData();
  form.append('fb_dtsg', p.dtsg);
  form.append('av', actor);
  form.append(
    'variables',
    JSON.stringify({
      input: {
        attachments: p.attachments, comment_id: btoa(`comment:${p.legacyToken}`), formatting_style: null,
        message: { ranges: p.ranges ?? [], text: p.text }, actor_id: actor, client_mutation_id: '11',
      },
    }),
  );
  form.append('doc_id', '5974409442669536');
  await graphql(form, p.pageId);
}

/** ID các bài mới nhất của nhóm (Feed.getPosts của metus-few — Graph API, token Ads). */
export async function getGroupPostIds(groupId: string, token: string, limit: number): Promise<string[]> {
  const res = await exFetch<any>(`https://graph.facebook.com/v9.0/${groupId}/feed`, {
    params: { show_expired: 'false', fields: 'id', limit, access_token: token },
  });
  const json = typeof res === 'string' ? JSON.parse(res) : res;
  if (json?.error) throw new Error(json.error.message ?? tr('gp.err.facebook'));
  return ((json?.data ?? []) as { id: string }[]).map((x) => String(x.id));
}

export async function createComment(p: { dtsg: string; fbId: string; postId: string; text: string; pageId?: string; photo?: LocalFile | null }): Promise<string | null> {
  const actor = p.pageId || p.fbId;
  // Ảnh bình luận: upload như ảnh bài viết rồi gắn media id (Comment.uploadPhoto của metus-few)
  const attachments = p.photo ? [{ media: { id: await uploadGroupImage({ dtsg: p.dtsg, fbId: p.fbId, file: p.photo, pageId: p.pageId }) } }] : null;
  const form = new FormData();
  form.append('fb_dtsg', p.dtsg);
  form.append('av', actor);
  form.append(
    'variables',
    JSON.stringify({
      displayCommentsFeedbackContext: null, displayCommentsContextEnableComment: null, displayCommentsContextIsAdPreview: null,
      displayCommentsContextIsAggregatedShare: null, displayCommentsContextIsStorySet: null, feedLocation: 'GROUP', feedbackSource: 0,
      focusCommentID: null, groupID: null, includeNestedComments: false,
      input: {
        attachments, feedback_id: btoa(`feedback:${p.postId}`), formatting_style: null, message: { ranges: [], text: p.text },
        reply_target_clicked: false, feedback_source: 'PROFILE', actor_id: actor, client_mutation_id: '18',
      },
      inviteShortLinkKey: null, renderLocation: null, scale: 1, useDefaultActor: false,
      UFI2CommentsProvider_commentsKey: 'CometGroupDiscussionRootSuccessQuery',
      __relay_internal__pv__GroupsCometDelayCheckBlockedUsersrelayprovider: false,
    }),
  );
  form.append('doc_id', '3988300734617853');
  const json = await graphql(form, p.pageId);
  return json?.data?.comment_create?.feedback_comment_edge?.node?.url ?? null;
}
