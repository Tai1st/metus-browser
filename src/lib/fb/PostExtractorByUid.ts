// Port từ metus-few/src/features/tools/group/post-extractor-by-uid/index.tsx
// + services/facebook/PostExtractorByUid.ts + services/facebook/checkUidType.ts.
// "Quét bài đăng theo UID" — nhận UID cá nhân HOẶC Group ID (tự nhận diện qua
// checkUidType), quét timeline cá nhân qua GraphQL riêng (ProfileCometManagePosts...)
// hoặc feed nhóm qua GraphQL riêng (CometGroupDiscussionRoot...) / Graph API
// token (chế độ "chạy nhanh", tái dùng fetchPagePostsPage vì /feed là endpoint
// chung cho Page/Group khi có access_token).
import qs from 'qs';

import { fetchPagePostsPage } from './pagePostAnalyze';
import { instance } from './compat';

const GRAPHQL = 'https://www.facebook.com/api/graphql/?metuscors=0';

export type Attachment = { image: string; caption?: string; type?: 'image' | 'video' | 'live' | 'poll' | string };

export interface ExtractedPost {
  id: string;
  url: string;
  message: string;
  content: string;
  creationTime: number;
  actor: { id?: string; name?: string; profileUrl?: string; profilePicture?: string };
  attachments: Attachment[];
  thumbnail: string;
  uidVia: string;
}

// Giải mã ID post từ dạng Base64 Relay global id.
function decodePostId(encodedId: string): string {
  try {
    const decoded = atob(encodedId);
    const parts = decoded.split(':');
    return parts[parts.length - 1] || encodedId;
  } catch {
    return encodedId;
  }
}

function extractLabelText(ghlLabel: any): string {
  if (!ghlLabel?.children?.length) return '';
  return ghlLabel.children
    .filter((child: any) => !child.styles?.some((s: any) => s.name === 'display' && s.val === 'none'))
    .map((child: any) => child.text || '')
    .join('');
}

/** Lấy toàn bộ ảnh/video/poll từ 1 node bài viết. */
function getAttachments(node: any): Attachment[] {
  const allAttachments = [...(node?.attachments || []), ...(node?.attached_story?.attachments || [])];

  return allAttachments.flatMap((att: any) => {
    const result: Attachment[] = [];
    const mainAttachment = att.style_type_renderer?.attachment;
    const media = mainAttachment?.media;

    const mediaImageUri = media?.image?.uri || media?.preferred_thumbnail?.image?.uri || media?.thumbnail_image?.uri || '';
    if (mediaImageUri) {
      const isVideo = media.__typename === 'Video';
      const isLive = media.__typename === 'LiveVideo';
      result.push({ image: mediaImageUri, caption: media.accessibility_caption || '', type: isLive ? 'live' : isVideo ? 'video' : 'image' });
    }

    const subs = mainAttachment?.all_subattachments?.nodes || [];
    for (const sub of subs) {
      const subMedia = sub.media;
      const subImageUri = subMedia?.image?.uri || subMedia?.preferred_thumbnail?.image?.uri || subMedia?.thumbnail_image?.uri || '';
      if (subImageUri) {
        const isVideo = subMedia.__typename === 'Video';
        const isLive = subMedia.__typename === 'LiveVideo';
        result.push({ image: subImageUri, caption: subMedia.accessibility_caption || '', type: isLive ? 'live' : isVideo ? 'video' : 'image' });
      }
    }

    const poll = mainAttachment?.poll;
    if (poll?.question?.text && poll.options?.length) {
      const options = poll.options.map((o: any) => `${o.text} (${o.total_count || 0})`).join(' | ');
      result.push({ image: '', caption: `[Poll] ${poll.question.text} → ${options}`, type: 'poll' });
    }

    return result;
  });
}

async function postGraphql(dtsg: string, fbId: string, body: Record<string, unknown>): Promise<string> {
  const data = qs.stringify(body);
  const { data: raw } = await instance.post<string>(GRAPHQL, data, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    responseType: 'text',
    transformResponse: (r) => r,
  });
  return raw;
}

// ───────────────────────────── Nhận diện UID (User / Group) ─────────────────────────────

export type UidType = 'User' | 'Group' | 'Unknown';

export async function checkUidType(dtsg: string, fbId: string, uid: string): Promise<UidType> {
  const variables = { actionBarRenderLocation: 'WWW_COMET_HOVERCARD', context: 'DEFAULT', entityID: uid, scale: 2 };
  try {
    const raw = await postGraphql(dtsg, fbId, {
      dpr: '1',
      __a: '1',
      fb_dtsg: dtsg,
      fb_api_req_friendly_name: 'CometHovercardQueryRendererQuery',
      variables: JSON.stringify(variables),
      doc_id: '27838033792508877',
    });
    const json = JSON.parse(raw.split('\n')[0]);
    const typename = json?.data?.node?.__typename;
    if (typename === 'User') return 'User';
    if (typename === 'Group') return 'Group';
    return 'Unknown';
  } catch {
    return 'Unknown';
  }
}

// ───────────────────────────── Quét timeline cá nhân (UID) ─────────────────────────────

export interface ProfilePostsPage {
  posts: ExtractedPost[];
  hasNextPage: boolean;
  endCursor: string | null;
}

export async function fetchProfilePostsPage(dtsg: string, fbId: string, uid: string, cursor: string): Promise<ProfilePostsPage> {
  const isFirstPage = cursor === '';
  const variables: any = {
    cursor,
    afterTime: null,
    beforeTime: null,
    gridMediaWidth: 230,
    includeGroupScheduledPosts: false,
    includeScheduledPosts: false,
    omitPinnedPost: false,
    postedBy: null,
    privacy: null,
    privacySelectorRenderLocation: 'COMET_STREAM',
    scale: 2,
    taggedInOnly: false,
    renderLocation: 'timeline',
  };
  if (isFirstPage) {
    variables.userID = uid;
  } else {
    variables.id = uid;
    variables.__relay_internal__pv__GHLShouldChangeSponsoredDataFieldNamerelayprovider = true;
  }

  const raw = await postGraphql(dtsg, fbId, {
    dpr: '1',
    __a: '1',
    fb_dtsg: dtsg,
    fb_api_req_friendly_name: isFirstPage ? 'ProfileCometManagePostsTimelineRootQuery' : 'CometManagePostsFeedRefetchQuery',
    variables: JSON.stringify(variables),
    doc_id: isFirstPage ? '8218825384885789' : '8847372595369742',
  });

  const lines = raw.split('\n').filter(Boolean);
  const allNodes: any[] = [];
  let endCursor: string | null = null;
  let hasNextPage = false;

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      const units = obj?.data?.user?.timeline_manage_feed_units;
      if (units?.edges?.length) {
        allNodes.push(...units.edges.map((e: any) => e.node));
        if (units?.page_info?.end_cursor) {
          endCursor = units.page_info.end_cursor;
          hasNextPage = units.page_info.has_next_page;
        }
      }
      if (obj?.data?.node?.__typename === 'Story') allNodes.push(obj.data.node);
      if (obj?.data?.cursor) {
        endCursor = obj.data.cursor;
        hasNextPage = true;
      }
    } catch {
      // bỏ qua dòng NDJSON lỗi
    }
  }

  const posts: ExtractedPost[] = allNodes.map((node: any) => {
    const actor = node.comet_sections?.actor_photo?.story?.actors?.[0] || {};
    const messageText =
      node.message?.text ||
      node.comet_sections?.message?.story?.message?.text ||
      node.title?.text ||
      node.summary?.text ||
      extractLabelText(node.comet_sections?.timestamp?.story?.ghl_label) ||
      '';
    const attachedText = node.attached_story?.comet_sections?.message?.story?.message?.text || '';
    const postUrl = node.url || node.comet_sections?.timestamp?.story?.url || '';
    const creationTime = node.creation_time || node.comet_sections?.timestamp?.story?.creation_time || 0;
    const attachments = getAttachments(node);
    const content = [messageText, attachedText].filter(Boolean).join('\n');
    return {
      id: decodePostId(node.id),
      url: postUrl,
      message: messageText,
      content,
      creationTime,
      actor: { id: actor.id, name: actor.name, profileUrl: actor.profile_url || actor.url, profilePicture: actor.profile_picture?.uri },
      attachments,
      thumbnail: attachments[0]?.image || '',
      uidVia: uid,
    };
  });

  return { posts, hasNextPage, endCursor };
}

// ───────────────────────────── Quét feed nhóm (Group ID) qua web GraphQL ─────────────────────────────

export interface GroupPostsPage {
  posts: ExtractedPost[];
  /** Bản gốc coi cursor rỗng/undefined là hết trang — không có cờ hasNextPage riêng. */
  nextCursor: string | null;
}

export async function fetchGroupPostsPageWeb(dtsg: string, fbId: string, groupId: string, cursor: string): Promise<GroupPostsPage> {
  const isFirstPage = cursor === '';
  const variables: any = isFirstPage
    ? {
        autoOpenChat: false,
        creative_provider_id: null,
        feedbackSource: 0,
        feedLocation: 'GROUP',
        feedType: 'DISCUSSION',
        focusCommentID: null,
        groupID: groupId,
        hasHoistStories: false,
        hoistedSectionHeaderType: 'notifications',
        hoistStories: [],
        hoistStoriesCount: 0,
        privacySelectorRenderLocation: 'COMET_STREAM',
        regular_stories_count: 1,
        regular_stories_stream_initial_count: 1,
        renderLocation: 'group',
        scale: 2,
        shouldDeferMainFeed: false,
        sortingSetting: 'CHRONOLOGICAL',
        threadID: '',
        useDefaultActor: false,
        __relay_internal__pv__GroupsCometLazyLoadFeaturedSectionrelayprovider: false,
        __relay_internal__pv__EventCometCardImage_prefetchEventImagerelayprovider: false,
        __relay_internal__pv__GHLShouldChangeAdIdFieldNamerelayprovider: false,
        __relay_internal__pv__GHLShouldChangeSponsoredDataFieldNamerelayprovider: false,
        __relay_internal__pv__IsWorkUserrelayprovider: false,
        __relay_internal__pv__CometFeedStoryDynamicResolutionPhotoAttachmentRenderer_experimentWidthrelayprovider: 500,
        __relay_internal__pv__CometImmersivePhotoCanUserDisable3DMotionrelayprovider: false,
        __relay_internal__pv__WorkCometIsEmployeeGKProviderrelayprovider: false,
        __relay_internal__pv__IsMergQAPollsrelayprovider: false,
        __relay_internal__pv__FBReelsMediaFooter_comet_enable_reels_ads_gkrelayprovider: false,
        __relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider: false,
        __relay_internal__pv__CometUFIShareActionMigrationrelayprovider: true,
        __relay_internal__pv__StoriesArmadilloReplyEnabledrelayprovider: true,
        __relay_internal__pv__GroupsCometGroupChatLazyLoadLastMessageSnippetrelayprovider: false,
      }
    : {
        count: 10,
        cursor,
        feedLocation: 'GROUP',
        feedType: 'DISCUSSION',
        feedbackSource: 0,
        filterTopicId: null,
        focusCommentID: null,
        privacySelectorRenderLocation: 'COMET_STREAM',
        renderLocation: 'group',
        scale: 1,
        sortingSetting: 'TOP_POSTS',
        stream_initial_count: 1,
        useDefaultActor: false,
        id: groupId,
        __relay_internal__pv__GHLShouldChangeAdIdFieldNamerelayprovider: true,
        __relay_internal__pv__GHLShouldChangeSponsoredDataFieldNamerelayprovider: true,
        __relay_internal__pv__IsWorkUserrelayprovider: false,
        __relay_internal__pv__FBReels_deprecate_short_form_video_context_gkrelayprovider: true,
        __relay_internal__pv__FeedDeepDiveTopicPillThreadViewEnabledrelayprovider: false,
        __relay_internal__pv__FBReels_enable_view_dubbed_audio_type_gkrelayprovider: false,
        __relay_internal__pv__CometImmersivePhotoCanUserDisable3DMotionrelayprovider: false,
        __relay_internal__pv__WorkCometIsEmployeeGKProviderrelayprovider: false,
        __relay_internal__pv__IsMergQAPollsrelayprovider: false,
        __relay_internal__pv__FBReelsMediaFooter_comet_enable_reels_ads_gkrelayprovider: true,
        __relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider: false,
        __relay_internal__pv__CometUFIShareActionMigrationrelayprovider: true,
        __relay_internal__pv__CometUFI_dedicated_comment_routable_dialog_gkrelayprovider: false,
        __relay_internal__pv__StoriesArmadilloReplyEnabledrelayprovider: true,
        __relay_internal__pv__FBReelsIFUTileContent_reelsIFUPlayOnHoverrelayprovider: true,
      };

  const raw = await postGraphql(dtsg, fbId, {
    dpr: '1',
    __a: '1',
    fb_dtsg: dtsg,
    fb_api_req_friendly_name: isFirstPage ? 'CometGroupDiscussionRootSuccessQuery' : 'GroupsCometFeedRegularStoriesPaginationQuery',
    doc_id: isFirstPage ? '9165830940160555' : '24549812544635891',
    variables: JSON.stringify(variables),
  });

  const lines = raw.split('\n').filter(Boolean);
  const posts: ExtractedPost[] = [];
  let nextCursor: string | null = null;

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (!obj.label) continue;
      const path: string[] = obj.path || [];
      if (!['group_feed', 'edges'].every((seg) => path.includes(seg))) continue;

      const node = obj.data?.node;
      if (node) {
        const actor =
          node.comet_sections?.context_layout?.story?.comet_sections?.actor_photo?.story?.actors?.[0] ||
          node.comet_sections?.context_layout?.story?.comet_sections?.title?.story?.actors?.[0] ||
          node.comet_sections?.content?.story?.actors?.[0];
        const messageText =
          node.comet_sections?.content?.story?.message?.text ||
          node.comet_sections?.content?.story?.comet_sections?.message?.story?.message?.text ||
          node.comet_sections?.content?.story?.comet_sections?.message_container?.story?.message?.text ||
          '';
        const postUrl =
          node.comet_sections?.content?.story?.wwwURL ||
          node.comet_sections?.context_layout?.story?.comet_sections?.metadata?.find((m: any) => m.story?.url)?.story?.url ||
          '';
        const creationTime =
          node.comet_sections?.context_layout?.story?.comet_sections?.metadata?.find((m: any) => m.story?.creation_time)?.story
            ?.creation_time || 0;
        const attachments = getAttachments(node.comet_sections?.content?.story || node);

        if (node.id || node.post_id || messageText || actor) {
          posts.push({
            id: decodePostId(node.id || node.post_id || ''),
            url: postUrl,
            message: messageText,
            content: messageText,
            creationTime,
            actor: { id: actor?.id, name: actor?.name, profileUrl: actor?.profile_url || actor?.url, profilePicture: actor?.profile_picture?.uri },
            attachments,
            thumbnail: node.attachments?.[0]?.styles?.attachment?.all_subattachments?.nodes?.[0]?.media?.image?.uri || '',
            uidVia: groupId,
          });
        }
      }
      nextCursor = obj.data?.cursor ?? null;
    } catch {
      // bỏ qua dòng NDJSON lỗi
    }
  }

  return { posts, nextCursor };
}

// ───────────────────────────── Chế độ "chạy nhanh" cho Group (Graph API token) ─────────────────────────────

export async function fetchGroupPostsFast(groupId: string, adsToken: string, limit: number): Promise<ExtractedPost[]> {
  const { posts } = await fetchPagePostsPage({ pageId: groupId, token: adsToken });
  return posts.slice(0, limit).map((p) => ({
    id: p.id.includes('_') ? p.id.split('_')[1] : p.id,
    url: p.permalinkUrl,
    message: p.content,
    content: p.content,
    creationTime: Math.floor(new Date(p.createdTime).getTime() / 1000),
    actor: { id: p.user.id, name: p.user.name },
    attachments: p.image ? [{ image: p.image }] : [],
    thumbnail: p.image || '',
    uidVia: groupId,
  }));
}
