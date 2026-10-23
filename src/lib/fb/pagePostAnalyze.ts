// Dịch vụ "Phân tích bài đăng trang" — port từ metus-few
// (features/tools/page/page-posts-analyze). Lấy thông tin Page rồi quét feed
// theo khoảng thời gian, trả về từng trang kết quả để UI tự dựng vòng lặp
// (giống GroupExtractorByUid) thay vì tự quản lý state như bản web.
import { exFetch } from './compat';

const GRAPH = 'https://graph.facebook.com';

export type PostType = 'photo' | 'link' | 'media_set' | 'video' | 'text' | 'album' | 'shared' | 'others';

export interface PagePostInfo {
  id: string;
  name: string;
  fan_count: number;
  avatar: string;
}

export interface PagePostRow {
  id: string;
  type: PostType;
  user: { id: string; name: string; url: string };
  createdTime: string;
  content: string;
  likes: number;
  comments: number;
  shares: number;
  image: string | null;
}

function getPostType(attachments?: Array<{ type?: string }>): PostType {
  if (!attachments || attachments.length === 0) return 'text';
  switch (attachments[0]?.type) {
    case 'photo':
      return 'photo';
    case 'video':
    case 'video_autoplay':
      return 'video';
    case 'album':
      return 'album';
    case 'link':
      return 'link';
    case 'share':
      return 'shared';
    case 'media_set':
      return 'media_set';
    default:
      return 'others';
  }
}

/** Lấy tên/avatar/số follower của Page từ URL hoặc ID. */
export async function fetchPagePostInfo(urlOrId: string, token: string): Promise<PagePostInfo> {
  const data = await exFetch<any>(`${GRAPH}/v21.0/`, {
    params: { ids: urlOrId, fields: 'id,name,fan_count', access_token: token, metuscors: 0 },
  });
  if (data?.error) throw new Error(data.error.message);
  const p = data?.[urlOrId];
  if (!p) throw new Error('Page not found');
  return { id: p.id, name: p.name, fan_count: p.fan_count ?? 0, avatar: `${GRAPH}/${p.id}/picture?type=normal` };
}

const FEED_FIELDS =
  'id,message,created_time,from{id,name,link},full_picture,shares,reactions.limit(0).summary(true),comments.limit(0).summary(true),attachments{media,type,url,subattachments{media,type,url}}';

/** Quét 1 trang feed (100 bài/lượt); truyền `nextUrl` (từ lần trước) để lấy trang kế tiếp. */
export async function fetchPagePostsPage(opts: {
  pageId: string;
  token: string;
  nextUrl?: string;
  sinceUnix?: number;
  untilUnix?: number;
}): Promise<{ posts: PagePostRow[]; nextUrl?: string }> {
  let url = opts.nextUrl;
  if (!url) {
    const params = new URLSearchParams({ fields: FEED_FIELDS, limit: '100', access_token: opts.token, metuscors: '0' });
    if (opts.sinceUnix) params.set('since', String(opts.sinceUnix));
    if (opts.untilUnix) params.set('until', String(opts.untilUnix));
    url = `${GRAPH}/v21.0/${opts.pageId}/feed?${params.toString()}`;
  }
  const data = await exFetch<any>(url);
  if (data?.error) throw new Error(data.error.message);
  const raw: any[] = data?.data ?? [];
  const posts: PagePostRow[] = raw.map((post) => {
    const image = post.full_picture ?? post.attachments?.data?.[0]?.media?.image?.src ?? null;
    return {
      id: post.id,
      type: getPostType(post.attachments?.data),
      user: { id: post.from?.id ?? '', name: post.from?.name ?? '', url: post.from?.link ?? '' },
      createdTime: post.created_time,
      content: post.message ?? '',
      likes: post.reactions?.summary?.total_count ?? 0,
      comments: post.comments?.summary?.total_count ?? 0,
      shares: post.shares?.count ?? 0,
      image,
    };
  });
  return { posts, nextUrl: data?.paging?.next };
}
