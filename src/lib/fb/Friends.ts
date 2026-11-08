// Port từ metus-few services/facebook/Friends.ts (+ features/tools/profile/friends/
// hooks/useScanInteraction.ts cho phần "Quét tương tác"). "Quản lý bạn bè Facebook":
// danh sách bạn bè, chọc, huỷ kết bạn, xếp hạng (thực chất là danh sách liên hệ
// Messenger do FB tự xếp hạng theo tần suất nhắn tin — giữ nguyên hành vi gốc), và
// quét tương tác (mint access_token qua luồng OAuth GDP giả rồi quét toàn bộ bài
// đăng của mình qua Graph API để tính lượt thích/bình luận mỗi bạn bè).
import * as Crypto from 'expo-crypto';
import qs from 'qs';

import { exFetch, instance } from './compat';

const GRAPHQL = 'https://www.facebook.com/api/graphql/?metuscors=0';

export interface Friend {
  id: string;
  name: string;
  profileUrl: string;
  profilePicture: string;
  likeCount: number;
  commentCount: number;
  totalInteractions: number;
}

export interface FriendRanking {
  id: string;
  name: string;
  profileUrl: string;
  profilePicture: string;
}

export interface InteractionCount {
  uid: string;
  name?: string;
  profilePicture?: string;
  totalInteractions: number;
  reactions: number;
  comments: number;
}

/** Lấy danh sách bạn bè (không phân trang — giống đúng hành vi bản gốc, chỉ lấy 1 lượt trả về của doc_id này). */
export async function getFriends(dtsg: string, fbId: string): Promise<Friend[]> {
  const variables = { id: fbId, query: '', scale: 1 };
  const form = new FormData();
  form.append('fb_dtsg', dtsg);
  form.append('av', fbId);
  form.append('server_timestamps', 'true');
  form.append('doc_id', '4936483286421335');
  form.append('variables', JSON.stringify(variables));

  const { data: raw } = await instance.post<string>(GRAPHQL, form, { responseType: 'text', transformResponse: (r) => r });
  const json = JSON.parse(raw.split('\n')[0]);
  const edges: any[] = json?.data?.user?.friends?.edges ?? [];
  return edges.map((edge) => ({
    id: edge?.node?.id ?? '',
    name: edge?.node?.name ?? '',
    profileUrl: edge?.node?.url ?? '',
    profilePicture: edge?.node?.photo?.uri ?? '',
    likeCount: 0,
    commentCount: 0,
    totalInteractions: 0,
  }));
}

async function graphqlMutation(dtsg: string, docId: string, variables: unknown): Promise<any> {
  const form = qs.stringify({
    dpr: '1',
    __a: '1',
    server_timestamps: 'true',
    fb_dtsg: dtsg,
    doc_id: docId,
    variables: JSON.stringify(variables),
  });
  const raw = await exFetch<string>(GRAPHQL, { method: 'POST', body: form, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  const json = JSON.parse(String(raw).split('\n')[0]);
  if (json?.errors?.length) throw new Error(json.errors[0]?.message ?? 'Facebook trả về lỗi');
  return json;
}

/** Chọc bạn bè. */
export async function pokeFriend(dtsg: string, actorId: string, targetId: string): Promise<void> {
  await graphqlMutation(dtsg, '5028133957233114', { input: { actor_id: actorId, user_id: targetId } });
}

/** Huỷ kết bạn. */
export async function removeFriend(dtsg: string, actorId: string, targetId: string): Promise<void> {
  await graphqlMutation(dtsg, '8752443744796374', {
    input: { source: 'friending_jewel', unfriended_user_id: targetId, actor_id: actorId },
    scale: 1,
  });
}

/** "Xếp hạng bạn bè" — bản gốc lấy nhầm danh sách liên hệ Messenger (chat_sidebar_contacts, FB tự xếp hạng theo tần suất nhắn tin), không phải xếp hạng bạn bè thật. Giữ nguyên hành vi gốc. */
export async function getFriendsRanking(dtsg: string, numContacts = 100): Promise<FriendRanking[]> {
  const variables = {
    numContactsToFetch: numContacts,
    scale: 1,
    __relay_internal__pv__CometHomeContactListItemsContactListAnRankingIsEnabledrelayprovider: true,
  };
  const form = qs.stringify({
    dpr: '1',
    __a: '1',
    __aaid: '0',
    __ccg: 'GOOD',
    __comet_req: '15',
    server_timestamps: 'true',
    fb_dtsg: dtsg,
    fb_api_req_friendly_name: 'CometHomeContactsContainerQuery',
    variables: JSON.stringify(variables),
    doc_id: '8845828445504279',
  });
  const raw = await exFetch<string>(GRAPHQL, { method: 'POST', body: form, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  const json = JSON.parse(String(raw).split('\n')[0]);
  const contacts: any[] = json?.data?.viewer?.actor?.contacts_home_renderer?.viewer?.chat_sidebar_contacts ?? [];
  return contacts.map((c) => ({ id: c.id, name: c.name ?? '', profileUrl: c.url ?? '', profilePicture: c.profile_picture?.uri ?? '' }));
}

/**
 * Mint access_token qua luồng OAuth "GDP" giả (bản gốc dùng để quét tương tác qua
 * Graph API mà không cần đăng ký app riêng). Bản gốc hardcode actor_id của tác giả
 * (UID lạ, không phải người dùng hiện tại) — đã sửa dùng đúng fbId thật. experience_id/
 * logger_id cũng đổi sang random mỗi lần gọi thay vì giá trị tĩnh.
 */
async function mintInteractionToken(dtsg: string, fbId: string): Promise<string> {
  const experienceId = Crypto.randomUUID();
  const loggerId = Crypto.randomUUID();
  const extraParams = {
    app_id: '350685531728',
    kid_directed_site: 'false',
    logger_id: `"${loggerId}"`,
    next: '"confirm"',
    redirect_uri: '"https://www.facebook.com/connect/login_success.html"',
    response_type: '"token"',
    return_scopes: 'false',
    scope: JSON.stringify([
      'user_subscriptions', 'user_videos', 'user_website', 'user_work_history', 'friends_about_me',
      'friends_actions.books', 'friends_actions.music', 'friends_actions.news', 'friends_actions.video',
      'friends_activities', 'friends_birthday', 'friends_education_history', 'friends_events',
      'friends_games_activity', 'friends_groups', 'friends_hometown', 'friends_interests', 'friends_likes',
      'friends_location', 'friends_notes', 'friends_photos', 'friends_questions', 'friends_relationship_details',
      'friends_relationships', 'friends_religion_politics', 'friends_status', 'friends_subscriptions',
      'friends_videos', 'friends_website', 'friends_work_history', 'ads_management', 'create_event',
      'create_note', 'export_stream', 'friends_online_presence', 'manage_friendlists', 'manage_notifications',
      'manage_pages', 'photo_upload', 'publish_stream', 'read_friendlists', 'read_insights', 'read_mailbox',
      'read_page_mailboxes', 'read_requests', 'read_stream', 'rsvp_event', 'share_item', 'sms', 'status_update',
      'user_online_presence', 'video_upload', 'xmpp_login',
    ]),
    steps: '{}',
    tp: '"unspecified"',
    cui_gk: '"[PASS]:"',
    is_limited_login_shim: 'false',
  };
  const variables = {
    input: {
      client_mutation_id: '4',
      actor_id: fbId,
      config_enum: 'GDP_CONFIRM',
      device_id: null,
      experience_id: experienceId,
      extra_params_json: JSON.stringify(extraParams),
      flow_name: 'GDP',
      flow_step_type: 'STANDALONE',
      outcome: 'APPROVED',
      source: 'gdp_delegated',
      surface: 'FACEBOOK_COMET',
    },
  };
  const form = qs.stringify({
    dpr: '1',
    __a: '1',
    __aaid: '0',
    __ccg: 'GOOD',
    __comet_req: '15',
    server_timestamps: 'true',
    fb_dtsg: dtsg,
    doc_id: '6494107973937368',
    variables: JSON.stringify(variables),
  });
  const raw = await exFetch<string>('https://www.facebook.com/api/graphql', {
    method: 'POST',
    body: form,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  const json = JSON.parse(String(raw).split('\n')[0]);
  const uri: string | undefined = json?.data?.run_post_flow_action?.uri;
  if (!uri) throw new Error('Không lấy được access_token từ Facebook');
  const decoded = decodeURIComponent(uri);
  const match = decoded.match(/access_token=([^&]+)/);
  if (!match) throw new Error('Không tìm thấy access_token trong phản hồi');
  return match[1];
}

const POST_FIELDS = 'id,reactions.limit(1000){id,name,pic_square},comments.limit(1000){from{id,name,pic_square}},created_time';

/** Quét toàn bộ bài đăng của mình qua Graph API, tổng hợp lượt thích/bình luận theo từng UID. */
async function scanOwnPostsInteractions(token: string, onPage?: (page: number) => void): Promise<InteractionCount[]> {
  const interactionMap = new Map<string, InteractionCount>();
  const bump = (uid: string, name: string | undefined, pic: string | undefined, kind: 'reactions' | 'comments') => {
    if (!uid) return;
    if (!interactionMap.has(uid)) interactionMap.set(uid, { uid, name, profilePicture: pic, totalInteractions: 0, reactions: 0, comments: 0 });
    const row = interactionMap.get(uid)!;
    row[kind]++;
    row.totalInteractions++;
  };

  let url: string | undefined = 'https://graph.facebook.com/v14.0/me/posts';
  let params: Record<string, unknown> | undefined = { fields: POST_FIELDS, limit: 100, access_token: token };
  const MAX_PAGES = 20;
  let page = 0;
  while (url && page < MAX_PAGES) {
    const data: any = await exFetch<any>(url, params ? { params } : undefined);
    if (data?.error) throw new Error(data.error.message ?? 'Facebook trả về lỗi');
    for (const post of data?.data ?? []) {
      for (const r of post.reactions?.data ?? []) bump(r.id, r.name, r.pic_square, 'reactions');
      for (const c of post.comments?.data ?? []) bump(c.from?.id, c.from?.name, c.from?.pic_square, 'comments');
    }
    page++;
    onPage?.(page);
    url = data?.paging?.next;
    params = undefined;
    if (url) await new Promise((r) => setTimeout(r, 2000));
  }
  return Array.from(interactionMap.values()).sort((a, b) => b.totalInteractions - a.totalInteractions);
}

export interface ScanProgress {
  step: 'idle' | 'getting-token' | 'scanning-posts' | 'completed';
  message: string;
}

/** Quét tương tác đầy đủ (mint token rồi quét bài đăng). */
export async function scanInteractions(dtsg: string, fbId: string, onProgress?: (p: ScanProgress) => void): Promise<InteractionCount[]> {
  onProgress?.({ step: 'getting-token', message: 'Đang lấy access token...' });
  const token = await mintInteractionToken(dtsg, fbId);
  onProgress?.({ step: 'scanning-posts', message: 'Đang quét bài đăng...' });
  const result = await scanOwnPostsInteractions(token, (page) => onProgress?.({ step: 'scanning-posts', message: `Đang quét bài đăng (trang ${page})...` }));
  onProgress?.({ step: 'completed', message: `Hoàn tất — ${result.length} người có tương tác.` });
  return result;
}
