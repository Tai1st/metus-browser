// Port từ metus-few services/facebook/FbShareToPages.ts. "Chia sẻ lên nhiều
// Fanpage": không dùng GraphQL nội bộ — chỉ là Graph API công khai, tạo 1 bài
// link mới trỏ về link gốc trên từng Page (không phải nút "Share" gốc của FB),
// dùng access_token của từng Page. Link dạng facebook.com/share/p/... cần
// resolve qua redirect để lấy URL bài gốc trước khi share.
import { Metus } from '@metus/http';

import { exFetch } from './compat';

const GRAPH = 'https://graph.facebook.com';

/** facebook.com/share/p/... là link rút gọn, cần theo redirect để lấy URL bài gốc. */
export async function resolveShareLink(link: string): Promise<string> {
  if (!link.includes('facebook.com/share/p/')) return link;
  try {
    const res = await Metus.http.request<string>({ url: link, method: 'GET', followRedirects: true, responseType: 'text' });
    return res.url || link;
  } catch {
    return link;
  }
}

/** Tạo 1 bài link mới trên Page, trỏ về `link` gốc (giống metus-few — không phải share gốc). */
export async function shareToPage(pageId: string, pageAccessToken: string, link: string, message: string): Promise<string> {
  const data = await exFetch<any>(`${GRAPH}/${pageId}/feed`, {
    method: 'POST',
    body: { link, message, published: 1 },
    params: { access_token: pageAccessToken, metuscors: 0 },
  });
  if (data?.error) throw new Error(data.error.message ?? 'Facebook trả về lỗi');
  if (!data?.id) throw new Error('Facebook không trả post_id');
  return data.id as string;
}

/** Ẩn bài vừa đăng khỏi dòng thời gian Page (tuỳ chọn "Ẩn bài sau khi share"). */
export async function hideSharedPost(postId: string, pageAccessToken: string): Promise<void> {
  await exFetch(`${GRAPH}/${postId}/hidden`, { method: 'POST', params: { access_token: pageAccessToken, metuscors: 0 } });
}
