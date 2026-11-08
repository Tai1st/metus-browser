/**
 * Bot trả lời bình luận Page — port từ metus-few features/tools/auto-comment
 * (facebook-webhooks.service.ts::handleReplyComment). Bản gốc dùng Facebook
 * Webhook (app Graph API chính thức) để nhận bình luận mới theo thời gian
 * thực; metus-browser không có backend nhận webhook nên thay bằng polling:
 * định kỳ quét bình luận mới trên các bài gần nhất của Page bằng Graph API
 * public (access_token của Page), rồi áp các hành động giống bản gốc
 * (ẩn / thích / trả lời theo mẫu [spin]). Chỉ giữ 4 tính năng thực sự chạy
 * được trong bản gốc — các toggle "isReplyFirstTime", xoá/ẩn theo từ khoá
 * riêng từng Page, setting riêng theo từng bài đều bị comment-out trong
 * backend gốc (không hoạt động) nên không port.
 */
import { exFetch } from './compat';

const GRAPH = 'https://graph.facebook.com';

export interface PageComment {
  id: string;
  message: string;
  fromId: string;
  fromName: string;
  createdUnix: number;
  /** true nếu là bình luận gốc (không phải reply của 1 bình luận khác). */
  isTopLevel: boolean;
}

/** Quét bình luận mới nhất của 1 bài (order=reverse_chronological để dừng sớm khi đã gặp bình luận cũ). */
export async function fetchPostComments(postId: string, token: string, limit = 50): Promise<PageComment[]> {
  const data = await exFetch<any>(`${GRAPH}/${postId}/comments`, {
    params: {
      fields: 'id,message,from{id,name},created_time,parent',
      filter: 'stream',
      order: 'reverse_chronological',
      limit,
      access_token: token,
      metuscors: 0,
    },
  });
  if (data?.error) throw new Error(data.error.message);
  const raw: any[] = data?.data ?? [];
  return raw.map((cm) => ({
    id: cm.id,
    message: cm.message ?? '',
    fromId: cm.from?.id ?? '',
    fromName: cm.from?.name ?? '',
    createdUnix: Math.floor(new Date(cm.created_time).getTime() / 1000),
    isTopLevel: !cm.parent,
  }));
}

/** Thích 1 bình luận bằng token của Page (giống likePost của videoCarousel.ts, trỏ vào comment id). */
export async function likeComment(commentId: string, pageAccessToken: string): Promise<void> {
  await exFetch(`${GRAPH}/${commentId}/likes?metuscors=0`, { method: 'POST', params: { access_token: pageAccessToken } });
}

/** Ẩn 1 bình luận (facebookProvider.hideComment của metus-few). */
export async function hideComment(commentId: string, pageAccessToken: string): Promise<void> {
  const data = await exFetch<any>(`${GRAPH}/${commentId}?metuscors=0`, {
    method: 'POST',
    params: { is_hidden: 'true', access_token: pageAccessToken },
  });
  if (data?.error) throw new Error(data.error.message);
}
