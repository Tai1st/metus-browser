// Port nguyên văn từ metus-few/src/services/facebook/GroupSearchByKeyword.ts (chỉ đổi import).
// Dùng Facebook Comet Search (facebook.com/search/groups?q=...) để tìm nhóm MỚI
// (chưa tham gia) theo từ khóa — khác hẳn getGroups (Group.ts, liệt kê nhóm đã
// là thành viên/quản trị). Giữ nguyên doc_id/RELAY_PROVIDERS/args khớp đúng
// request thật của FB, không tự ý đổi.
import qs from 'qs';

import { instance } from './compat';

const INITIAL_DOC_ID = '27609539182000529';
const PAGINATED_DOC_ID = '28091046377146459';

// Các cờ tính năng nội bộ của FB, giữ nguyên theo request thật để doc_id hoạt động
const RELAY_PROVIDERS = {
  __relay_internal__pv__GHLShouldChangeAdIdFieldNamerelayprovider: true,
  __relay_internal__pv__GHLShouldChangeSponsoredDataFieldNamerelayprovider: true,
  __relay_internal__pv__CometFeedStory_enable_reactor_facepilerelayprovider: false,
  __relay_internal__pv__CometFeedStory_enable_social_bubblesrelayprovider: false,
  __relay_internal__pv__CometFeedStory_enable_post_permalink_white_space_clickrelayprovider: false,
  __relay_internal__pv__CometUFICommentActionLinksRewriteEnabledrelayprovider: true,
  __relay_internal__pv__CometUFICommentAvatarStickerAnimatedImagerelayprovider: false,
  __relay_internal__pv__IsWorkUserrelayprovider: false,
  __relay_internal__pv__TestPilotShouldIncludeDemoAdUseCaserelayprovider: false,
  __relay_internal__pv__FBReels_deprecate_short_form_video_context_gkrelayprovider: true,
  __relay_internal__pv__FBReels_enable_view_dubbed_audio_type_gkrelayprovider: true,
  __relay_internal__pv__CometFeedShareMedia_shouldPrefetchShareImagerelayprovider: false,
  __relay_internal__pv__CometImmersivePhotoCanUserDisable3DMotionrelayprovider: false,
  __relay_internal__pv__WorkCometIsEmployeeGKProviderrelayprovider: false,
  __relay_internal__pv__IsMergQAPollsrelayprovider: false,
  __relay_internal__pv__FBReelsMediaFooter_comet_enable_reels_ads_gkrelayprovider: true,
  __relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider: false,
  __relay_internal__pv__CometUFICommentAutoTranslationTyperelayprovider: 'AUTO_TRANSLATE',
  __relay_internal__pv__CometUFIShareActionMigrationrelayprovider: true,
  __relay_internal__pv__CometUFISingleLineUFIrelayprovider: false,
  __relay_internal__pv__relay_provider_comet_ufi_ssr_seo_deferrelayprovider: true,
  __relay_internal__pv__CometUFI_dedicated_comment_routable_dialog_gkrelayprovider: true,
  __relay_internal__pv__ReelsIFUCard_reelsIFULikeCountrelayprovider: false,
  __relay_internal__pv__FBReelsIFUTileContent_reelsIFUPlayOnHoverrelayprovider: true,
  __relay_internal__pv__GroupsCometGYSJFeedItemHeightrelayprovider: 206,
  __relay_internal__pv__ShouldEnableBakedInTextStoriesrelayprovider: false,
  __relay_internal__pv__StoriesShouldIncludeFbNotesrelayprovider: false,
};

let searchSession: { bsid: string; tsid: string } | null = null;

const getSearchSession = () => {
  if (!searchSession) {
    searchSession = {
      bsid: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      tsid: `0.${Math.floor(Math.random() * 1e10)}`,
    };
  }
  return searchSession;
};

const buildSearchArgs = (keyword: string) => {
  const { bsid, tsid } = getSearchSession();
  return {
    callsite: 'COMET_GLOBAL_SEARCH',
    config: { exact_match: false, high_confidence_config: null, intercept_config: null, sts_disambiguation: null, watch_config: null },
    context: { bsid, tsid },
    experience: { client_defined_experiences: ['ADS_PARALLEL_FETCH'], encoded_server_defined_params: null, fbid: null, type: 'GROUPS_TAB' },
    filters: [],
    text: keyword,
  };
};

// Tách "Công khai · 588K thành viên · 90+ bài viết/ngày" thành các phần riêng
const parseSnippet = (snippet: string) => {
  const parts = snippet
    .split('·')
    .map((p) => p.trim())
    .filter(Boolean);

  let privacy = '';
  let memberCount = '';
  let postFrequency = '';

  for (const part of parts) {
    if (/thành viên|members?$/i.test(part)) {
      memberCount = part.replace(/\s*(thành viên|members?)\s*$/i, '').trim();
    } else if (/bài viết|posts?/i.test(part)) {
      postFrequency = part;
    } else if (!privacy) {
      privacy = part;
    }
  }

  return { privacy, memberCount, postFrequency };
};

export interface GroupSearchResultItem {
  id: string;
  name: string;
  url: string;
  avatar: string;
  snippet: string;
  privacy: string;
  memberCount: string;
  postFrequency: string;
}

export interface GroupSearchPageResult {
  items: GroupSearchResultItem[];
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface FetchGroupSearchPageParams {
  dtsg: string;
  fbId: string;
  keyword: string;
  cursor?: string | null;
}

export async function fetchGroupSearchPage({ dtsg, fbId, keyword, cursor }: FetchGroupSearchPageParams): Promise<GroupSearchPageResult> {
  const isFirstPage = !cursor;

  const variables = isFirstPage
    ? {
        count: 5,
        allow_streaming: false,
        args: buildSearchArgs(keyword),
        cursor: null,
        feedbackSource: 23,
        fetch_filters: true,
        renderLocation: 'search_results_page',
        scale: 1,
        stream_initial_count: 0,
        useDefaultActor: false,
        ...RELAY_PROVIDERS,
      }
    : {
        allow_streaming: false,
        args: buildSearchArgs(keyword),
        count: 5,
        cursor,
        feedLocation: 'SEARCH',
        feedbackSource: 23,
        fetch_filters: true,
        focusCommentID: null,
        locale: null,
        privacySelectorRenderLocation: 'COMET_STREAM',
        referringStoryRenderLocation: null,
        renderLocation: 'search_results_page',
        scale: 1,
        stream_initial_count: 0,
        useDefaultActor: false,
        ...RELAY_PROVIDERS,
      };

  const data = qs.stringify({
    av: fbId,
    __user: fbId,
    __a: '1',
    __aaid: '0',
    dpr: '1',
    __ccg: 'EXCELLENT',
    __comet_req: '15',
    fb_dtsg: dtsg,
    server_timestamps: 'true',
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: isFirstPage ? 'SearchCometResultsInitialResultsQuery' : 'SearchCometResultsPaginatedResultsQuery',
    variables: JSON.stringify(variables),
    doc_id: isFirstPage ? INITIAL_DOC_ID : PAGINATED_DOC_ID,
  });

  const response = await instance.post<string>(`https://www.facebook.com/api/graphql/`, data, {
    headers: {
      accept: '*/*',
      'accept-language': 'vi,en-GB;q=0.9,en;q=0.8',
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://www.facebook.com',
      referer: `https://www.facebook.com/search/groups?q=${encodeURIComponent(keyword)}`,
    },
    responseType: 'text',
    transformResponse: (r) => r,
  });
  const raw = response.data;

  const firstLine = raw.split('\n')[0];
  let json: any;
  try {
    json = JSON.parse(firstLine);
  } catch {
    throw new Error('Không đọc được phản hồi từ Facebook (có thể bị chặn/redirect login)');
  }

  if (json?.errors?.length) {
    throw new Error(json.errors[0]?.message || 'Facebook trả về lỗi GraphQL');
  }

  // FB đôi khi trả về results lồng trong "data", đôi khi không (tuỳ doc_id/context)
  const results = json?.data?.serpResponse?.results || json?.serpResponse?.results;
  const edges: any[] = results?.edges || [];
  const pageInfo = results?.page_info;

  const items: GroupSearchResultItem[] = edges
    .filter((edge) => {
      const viewModel = edge?.rendering_strategy?.view_model;
      const profile = viewModel?.profile;
      return profile?.__typename === 'Group' && Boolean(profile?.id);
    })
    .map((edge): GroupSearchResultItem => {
      const viewModel = edge?.rendering_strategy?.view_model;
      const profile = viewModel?.profile;
      const snippet = viewModel?.primary_snippet_text_with_entities?.text || '';
      const { privacy, memberCount, postFrequency } = parseSnippet(snippet);
      return {
        id: profile.id as string,
        name: profile.name || '',
        url: profile.url || profile.profile_url || '',
        avatar: profile.profile_picture?.uri || '',
        snippet,
        privacy,
        memberCount,
        postFrequency,
      };
    });

  return {
    items,
    hasNextPage: Boolean(pageInfo?.has_next_page),
    endCursor: pageInfo?.end_cursor || null,
  };
}
