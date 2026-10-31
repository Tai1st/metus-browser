/**
 * Clone quảng cáo 2 ô (multi_share_no_end_card) từ Trang khác — port từ
 * metus-few features/tools/page/fb-carousel-deep-clone/hooks/useFbCarouselDeepClone.ts.
 * Chỉ trích xuất dữ liệu từ `attachments` thô của PagePostRow (xem pagePostAnalyze.ts);
 * việc dựng quảng cáo 2 ô dùng lại nguyên `createCarouselPost` (mode "carousel2").
 */
import type { RawAttachment } from './pagePostAnalyze';

/** true nếu bài là quảng cáo 2 ô kiểu "multi_share_no_end_card" (card video + card "Thích Trang"). */
export function isMultiShareCarousel(attachments: RawAttachment[]): boolean {
  return attachments[0]?.type === 'multi_share_no_end_card';
}

export interface MultiShareInfo {
  videoUrl: string | null;
  thumbnailUrl: string | null;
  card1Title: string;
  card1Description: string;
  card2Title: string;
  card2Description: string;
}

/** Trích xuất video/tiêu đề/mô tả của card 1 (video) và card 2 (share) từ subattachments. */
export function extractMultiShareInfo(attachments: RawAttachment[]): MultiShareInfo {
  const multiShare = attachments[0];
  const subs = multiShare?.subattachments?.data ?? [];
  const videoSub = subs.find((s) => s.type === 'video_direct_response_autoplay');
  const shareSub = subs.find((s) => s.type === 'share');
  return {
    videoUrl: videoSub?.media?.source ?? null,
    thumbnailUrl: videoSub?.media?.image?.src ?? null,
    card1Title: videoSub?.title ?? '',
    card1Description: videoSub?.description ?? '',
    card2Title: shareSub?.title ?? '',
    card2Description: shareSub?.description ?? '',
  };
}
