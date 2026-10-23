// Dịch vụ "Phân tích bài đăng nhóm" — port từ metus-few
// (features/tools/group/group-posts-analyze). Giống pagePostAnalyze.ts nhưng
// group không resolve được qua Graph `ids=` như Page nên phải scrape HTML
// trang nhóm để lấy numeric group ID trước.
import { exFetch } from './compat';

const GRAPH = 'https://graph.facebook.com';

export type PostType = 'photo' | 'link' | 'media_set' | 'video' | 'text' | 'album' | 'shared' | 'others';

export interface GroupPostInfo {
  id: string;
  name: string;
  memberCount: string;
  privacy: string;
  avatar: string;
}

export interface GroupPostRow {
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

const GROUP_ID_PATTERNS = [
  /"groupID"\s*:\s*"(\d+)"/,
  /"group_id"\s*:\s*"(\d+)"/,
  /"pageID"\s*:\s*"(\d+)"/,
  /"entity_id"\s*:\s*"(\d+)"/,
  /\\"groupID\\":\\"(\d+)\\"/,
];

async function scrapeGroupIdFromPage(groupUrl: string): Promise<string | null> {
  const html = await exFetch<string>(groupUrl);
  for (const pattern of GROUP_ID_PATTERNS) {
    const m = html.match(pattern);
    if (m) return m[1];
  }
  return null;
}

/** Link/slug/ID nhóm -> numeric group ID (slug chữ phải scrape HTML trang nhóm). */
export async function resolveGroupId(input: string): Promise<string | null> {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  const fromUrl = trimmed.match(/facebook\.com\/groups\/(\d+)/)?.[1];
  if (fromUrl) return fromUrl;
  const pageUrl = trimmed.startsWith('http') ? trimmed : `https://www.facebook.com/groups/${trimmed}`;
  return scrapeGroupIdFromPage(pageUrl);
}

/** Lấy tên/avatar/số thành viên/quyền riêng tư của nhóm từ numeric ID. */
export async function fetchGroupPostInfo(groupId: string, token: string): Promise<GroupPostInfo> {
  const data = await exFetch<any>(`${GRAPH}/v21.0/${groupId}`, {
    params: { fields: 'id,name,member_count,privacy,picture', access_token: token, metuscors: 0 },
  });
  if (data?.error) throw new Error(data.error.message);
  return {
    id: data.id,
    name: data.name,
    memberCount: (data.member_count ?? 0).toLocaleString(),
    privacy: data.privacy ?? '',
    avatar: data.picture?.data?.url ?? `${GRAPH}/${data.id}/picture?type=normal`,
  };
}

const FEED_FIELDS =
  'id,message,created_time,from{id,name,link},full_picture,shares,reactions.limit(0).summary(true),comments.limit(0).summary(true),attachments{media,type,url,subattachments{media,type,url}}';

/** Quét 1 trang feed nhóm (100 bài/lượt); truyền `nextUrl` (từ lần trước) để lấy trang kế tiếp. */
export async function fetchGroupPostsPage(opts: {
  groupId: string;
  token: string;
  nextUrl?: string;
  sinceUnix?: number;
  untilUnix?: number;
}): Promise<{ posts: GroupPostRow[]; nextUrl?: string }> {
  let url = opts.nextUrl;
  if (!url) {
    const params = new URLSearchParams({ fields: FEED_FIELDS, limit: '100', access_token: opts.token, metuscors: '0' });
    if (opts.sinceUnix) params.set('since', String(opts.sinceUnix));
    if (opts.untilUnix) params.set('until', String(opts.untilUnix));
    url = `${GRAPH}/v21.0/${opts.groupId}/feed?${params.toString()}`;
  }
  const data = await exFetch<any>(url);
  if (data?.error) throw new Error(data.error.message);
  const raw: any[] = data?.data ?? [];
  const posts: GroupPostRow[] = raw.map((post) => {
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
