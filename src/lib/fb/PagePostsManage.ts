// Port từ metus-few services/facebook/DeletePost.ts — 2 hành động dùng cho
// "Ẩn bài đăng Fanpage" và "Xoá bài đăng Fanpage": cả 2 đều là Graph API công
// khai dùng access_token của Page (không phải GraphQL nội bộ). Phần LIỆT KÊ
// bài viết để chọn ẩn/xoá dùng lại `fetchPagePostsPage` (pagePostAnalyze.ts,
// đã có sẵn trong app) thay vì port lại 2 cách liệt kê khác nhau của bản gốc
// (1 cái dùng GraphQL Business Content Manager doc_id rất phức tạp/dễ vỡ cho
// tool Ẩn, 1 cái dùng Graph API /posts cho tool Xoá) — vì mục tiêu cuối cùng
// như nhau (liệt kê bài của Page, lọc theo loại/ngày) và app đã có sẵn 1 cách
// làm đơn giản, đáng tin cậy hơn nhiều so với query Business Manager của bản gốc.
import { exFetch } from './compat';

const GRAPH = 'https://graph.facebook.com/v21.0';

/** Ẩn 1 bài đăng khỏi dòng thời gian Page (literal: body `timeline_visibility: 'hidden'`, không phải `is_hidden`). */
export async function hidePagePost(postId: string, pageAccessToken: string): Promise<void> {
  const data = await exFetch<any>(`${GRAPH}/${postId}?metuscors=0`, {
    method: 'POST',
    body: { timeline_visibility: 'hidden' },
    params: { access_token: pageAccessToken },
  });
  if (data?.error) throw new Error(data.error.message ?? 'Facebook trả về lỗi');
}

/** Xoá 1 bài đăng của Page. */
export async function deletePagePost(postId: string, pageAccessToken: string): Promise<void> {
  const data = await exFetch<any>(`${GRAPH}/${postId}?metuscors=0`, {
    method: 'DELETE',
    params: { access_token: pageAccessToken },
  });
  if (data?.error) throw new Error(data.error.message ?? 'Facebook trả về lỗi');
}
