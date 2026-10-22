import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Badge, Body, Card, IconCircle, Row, Title, radius, useColors } from '@/components/ui';
import { useI18n, useT } from '@/lib/i18n';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
type Category = 'Tự động hóa' | 'Tạo nội dung' | 'Phân tích' | 'Quản lý';
type Tone = 'accent' | 'info' | 'success' | 'danger' | 'muted';

export interface ToolItem {
  key: string;
  title: string;
  desc: string;
  category: Category;
  icon: IconName;
  /** Bản dịch tiếng Anh (fallback cho mọi ngôn ngữ khác tiếng Việt). */
  en?: { title: string; desc: string };
  /** Route thật nếu đã làm xong; bỏ trống = "Sắp có". */
  route?: Href;
}

// Toàn bộ công cụ port từ metus-few (3 cái đầu đã hoạt động, còn lại làm sau).
export const TOOLS: ToolItem[] = [
  // ----- Tự động hóa -----
  { key: 'auto-join', title: 'Tự động tham gia nhóm', desc: 'Gửi yêu cầu vào nhiều nhóm theo UID, đa luồng.', category: 'Tự động hóa', icon: 'people', route: '/tools/auto-join-fb-group', en: { title: 'Auto join groups', desc: 'Send join requests to many groups by UID, multi-threaded.' } },
  { key: 'auto-post', title: 'Đăng bài lên nhóm', desc: 'Đăng một nội dung lên nhiều nhóm, có giãn cách.', category: 'Tự động hóa', icon: 'create', route: '/tools/auto-post-fb-group', en: { title: 'Post to groups', desc: 'Post one content to many groups with spacing.' } },
  { key: 'auto-comment', title: 'Tự động bình luận nhóm', desc: 'Tự động bình luận vào nhiều nhóm Facebook.', category: 'Tự động hóa', icon: 'chatbubble-ellipses', route: '/tools/auto-comment-fb-group', en: { title: 'Auto comment on groups', desc: 'Automatically comment on many Facebook groups.' } },
  { key: 'page-comments-bot', title: 'Bot trả lời bình luận Page', desc: 'Tự động trả lời bình luận mới trên Page theo mẫu.', category: 'Tự động hóa', icon: 'chatbubbles', en: { title: 'Page comment reply bot', desc: 'Auto-reply to new Page comments using templates.' } },
  { key: 'auto-leave-group', title: 'Rời nhóm hàng loạt', desc: 'Rời khỏi nhiều nhóm Facebook cùng lúc.', category: 'Tự động hóa', icon: 'exit', en: { title: 'Bulk leave groups', desc: 'Leave many Facebook groups at once.' } },
  { key: 'up-to-reelsv2', title: 'Đăng Reels hàng loạt', desc: 'Tải nhiều video lên Reels, copy từ TikTok.', category: 'Tự động hóa', icon: 'film', route: '/tools/up-to-reelsv2', en: { title: 'Bulk upload Reels', desc: 'Upload many videos to Reels, copy from TikTok.' } },
  { key: 'up-to-stories', title: 'Đăng Stories hàng loạt', desc: 'Tải nhiều video lên Stories, kèm nút CTA.', category: 'Tự động hóa', icon: 'albums', route: '/tools/up-to-stories', en: { title: 'Bulk upload Stories', desc: 'Upload many videos to Stories with a CTA button.' } },
  { key: 'page-posts-clone', title: 'Sao chép bài trang khác', desc: 'Sao chép bài viết trang khác đăng lên trang mình.', category: 'Tự động hóa', icon: 'copy', en: { title: 'Clone posts from other pages', desc: "Copy another page's posts to your own page." } },
  { key: 'fb-carousel-deep-clone', title: 'Sao chép bài 2 ô trang khác', desc: 'Clone bài viết 2 ô từ trang khác.', category: 'Tự động hóa', icon: 'copy', en: { title: 'Clone 2-card posts', desc: 'Clone 2-card posts from another page.' } },
  { key: 'logo', title: 'Tạo logo Fanpage', desc: 'Tạo logo Fanpage đơn giản, không cần thiết kế.', category: 'Tự động hóa', icon: 'color-palette', en: { title: 'Create a Fanpage logo', desc: 'Create a simple Fanpage logo, no design needed.' } },

  // ----- Tạo nội dung -----
  { key: 'fb-video-carousel', title: 'Đăng Video 2 Ô Fanpage', desc: 'Tăng like và bình luận cho bài đăng.', category: 'Tạo nội dung', icon: 'videocam', route: '/tools/fb-video-carousel', en: { title: 'Post 2-card video (Page)', desc: 'Boost likes and comments for your post.' } },
  { key: 'fb-one-card-video-carousel', title: 'Đăng Video 1 Ô Fanpage', desc: 'Tạo bài One Card Video với nút Like.', category: 'Tạo nội dung', icon: 'videocam', route: '/tools/fb-one-card-video-carousel', en: { title: 'Post 1-card video (Page)', desc: 'Create a One Card Video with a Like button.' } },
  { key: 'fb-one-card-picture-carousel', title: 'Đăng ảnh 1 Ô Fanpage', desc: 'Tạo bài One Card ảnh lớn kèm website.', category: 'Tạo nội dung', icon: 'image', route: '/tools/fb-one-card-picture-carousel', en: { title: 'Post 1-card image (Page)', desc: 'Create a One Card large image with a website.' } },
  { key: 'post-a-card', title: 'Đăng bài 1 Ô (album giả)', desc: 'Tạo bài One Card album giả, ẩn link affiliate.', category: 'Tạo nội dung', icon: 'card', route: '/tools/post-a-card', en: { title: 'Post 1-card (fake album)', desc: 'Create a One Card fake album, hide affiliate links.' } },
  { key: 'swipe-up-video', title: 'Swipe Up Video', desc: 'Tạo video vuốt lên tăng truy cập website.', category: 'Tạo nội dung', icon: 'arrow-up-circle', route: '/tools/swipe-up-video', en: { title: 'Swipe Up Video', desc: 'Create swipe-up videos to drive website traffic.' } },
  { key: 'page-pics-posts', title: 'Đăng ảnh thường lên Trang', desc: 'Đăng & lên lịch nhiều ảnh lên trang một lần.', category: 'Tạo nội dung', icon: 'images', en: { title: 'Post photos to a Page', desc: 'Post & schedule many photos to a page at once.' } },
  { key: 'page-multi-photo-post', title: 'Đăng nhiều ảnh lên nhiều Trang', desc: 'Đăng nhiều ảnh + nền màu tới nhiều trang.', category: 'Tạo nội dung', icon: 'images', en: { title: 'Post many photos to many Pages', desc: 'Post many photos + color backgrounds to many pages.' } },
  { key: 'timeline-post', title: 'Đăng bài lên Trang cá nhân', desc: 'Đăng nhiều ảnh + nền màu lên trang cá nhân.', category: 'Tạo nội dung', icon: 'person-circle', en: { title: 'Post to personal timeline', desc: 'Post many photos + color backgrounds to your timeline.' } },
  { key: 'create-bm-pages', title: 'Tạo hàng loạt Fanpage', desc: 'Tạo nhiều Fanpage với tên & emoji ngẫu nhiên.', category: 'Tạo nội dung', icon: 'duplicate', en: { title: 'Bulk create Fanpages', desc: 'Create many Fanpages with random names & emojis.' } },

  // ----- Phân tích -----
  { key: 'group-extractor', title: 'Quét nhóm theo UID', desc: 'Trích danh sách nhóm một tài khoản tham gia.', category: 'Phân tích', icon: 'download', route: '/tools/group-extractor-by-uid', en: { title: 'Scan groups by UID', desc: 'Extract the list of groups an account has joined.' } },
  { key: 'group-search-by-keyword', title: 'Tìm nhóm theo từ khóa', desc: 'Tìm & trích nhóm Facebook theo từ khóa.', category: 'Phân tích', icon: 'search', en: { title: 'Find groups by keyword', desc: 'Find & extract Facebook groups by keyword.' } },
  { key: 'post-extractor-by-uid', title: 'Quét bài đăng theo UID', desc: 'Trích tất cả bài đăng theo UID, xuất Excel.', category: 'Phân tích', icon: 'document-text', en: { title: 'Scan posts by UID', desc: 'Extract all posts by UID, export to Excel.' } },
  { key: 'group-posts-analyze', title: 'Phân tích bài đăng nhóm', desc: 'Phân tích bài nhóm theo thời gian/loại nội dung.', category: 'Phân tích', icon: 'bar-chart', en: { title: 'Analyze group posts', desc: 'Analyze group posts by time / content type.' } },
  { key: 'page-posts-analyze', title: 'Phân tích bài đăng trang', desc: 'Phân tích bài trang theo thời gian, xuất CSV.', category: 'Phân tích', icon: 'stats-chart', en: { title: 'Analyze page posts', desc: 'Analyze page posts by time, export CSV.' } },
  { key: 'friends', title: 'Quản lý bạn bè Facebook', desc: 'Xem, lọc, xuất và quản lý bạn bè nâng cao.', category: 'Phân tích', icon: 'people-circle', en: { title: 'Manage Facebook friends', desc: 'View, filter, export and manage friends.' } },

  // ----- Quản lý -----
  { key: 'admin-groups-manager', title: 'Quản lý nhóm (Admin)', desc: 'Duyệt bài, chặn thành viên, xóa bài/bình luận.', category: 'Quản lý', icon: 'shield-checkmark', en: { title: 'Manage groups (Admin)', desc: 'Approve posts, block members, delete posts/comments.' } },
  { key: 'fb-share-to-pages', title: 'Chia sẻ lên nhiều Fanpage', desc: 'Chia sẻ bài lên nhiều Fanpage một cú nhấp.', category: 'Quản lý', icon: 'share-social', en: { title: 'Share to many Fanpages', desc: 'Share a post to many Fanpages in one click.' } },
  { key: 'page-posts-hide', title: 'Ẩn bài đăng Fanpage', desc: 'Ẩn bài đăng trên Fanpage siêu nhanh.', category: 'Quản lý', icon: 'eye-off', en: { title: 'Hide Fanpage posts', desc: 'Hide Fanpage posts super fast.' } },
  { key: 'page-posts-remover', title: 'Xóa bài đăng Fanpage', desc: 'Xóa bài đăng trên Fanpage siêu nhanh.', category: 'Quản lý', icon: 'trash', en: { title: 'Delete Fanpage posts', desc: 'Delete Fanpage posts super fast.' } },
  { key: 'group-posts-remover', title: 'Xóa bài đăng Group', desc: 'Xóa bài đăng trên Group siêu nhanh.', category: 'Quản lý', icon: 'trash', en: { title: 'Delete Group posts', desc: 'Delete Group posts super fast.' } },
  { key: 'group-pending-post-remover', title: 'Xóa bài chờ duyệt Group', desc: 'Xóa bài chờ duyệt trên Group siêu nhanh.', category: 'Quản lý', icon: 'trash-bin', en: { title: 'Delete pending Group posts', desc: 'Delete pending Group posts super fast.' } },
  { key: 'group-posts-spam-remover', title: 'Xóa bài spam Group', desc: 'Xóa bài spam trong Group siêu nhanh.', category: 'Quản lý', icon: 'trash-bin', en: { title: 'Delete spam Group posts', desc: 'Delete spam posts in Groups super fast.' } },
];

const CATEGORY_ORDER: Category[] = ['Tự động hóa', 'Tạo nội dung', 'Phân tích', 'Quản lý'];
const CATEGORY_TONE: Record<Category, Tone> = {
  'Tự động hóa': 'accent',
  'Tạo nội dung': 'info',
  'Phân tích': 'success',
  'Quản lý': 'muted',
};
export const CATEGORY_KEY: Record<Category, string> = {
  'Tự động hóa': 'category.auto',
  'Tạo nội dung': 'category.content',
  'Phân tích': 'category.analyze',
  'Quản lý': 'category.manage',
};

/** Text công cụ theo ngôn ngữ hiện tại (vi gốc, khác vi dùng bản `en`). */
export function useToolText(): (item: ToolItem) => { title: string; desc: string } {
  const { lang } = useI18n();
  return (item) => (lang !== 'vi' && item.en ? item.en : { title: item.title, desc: item.desc });
}

function openTool(item: ToolItem, title: string) {
  if (item.route) router.push(item.route);
  else router.push({ pathname: '/tools/coming-soon', params: { title, key: item.key } });
}

export function ToolCard({ item }: { item: ToolItem }) {
  const c = useColors();
  const t = useT();
  const text = useToolText()(item);
  return (
    <Card onPress={() => openTool(item, text.title)}>
      <Row gap={12}>
        <IconCircle name={item.icon} tone={CATEGORY_TONE[item.category]} />
        <View style={{ flex: 1, gap: 2 }}>
          <Row gap={6}>
            <Body weight="700" size={15}>{text.title}</Body>
            {!item.route ? <Badge text={t('tools.soon')} tone="muted" /> : null}
          </Row>
          <Body muted size={13} numberOfLines={2}>{text.desc}</Body>
        </View>
        <Ionicons name="chevron-forward" size={18} color={c.faint} />
      </Row>
    </Card>
  );
}

/** Danh sách phẳng (dùng cho "Công cụ nổi bật" ở trang chủ). */
export function ToolList({ limit }: { limit?: number }) {
  const items = limit ? TOOLS.slice(0, limit) : TOOLS;
  return (
    <>
      {items.map((it) => (
        <ToolCard key={it.key} item={it} />
      ))}
    </>
  );
}

/** Danh sách đầy đủ, chia theo nhóm (dùng cho tab Công cụ). */
export function ToolSections() {
  const t = useT();
  return (
    <>
      {CATEGORY_ORDER.map((cat) => {
        const items = TOOLS.filter((it) => it.category === cat);
        if (items.length === 0) return null;
        return (
          <View key={cat} style={{ gap: 12 }}>
            <Title size="md">{t(CATEGORY_KEY[cat])}</Title>
            {items.map((it) => (
              <ToolCard key={it.key} item={it} />
            ))}
          </View>
        );
      })}
    </>
  );
}

// ---------------- Dạng lưới (theo thiết kế mới) ----------------

export type ToolTag = 'Tất cả' | 'Facebook' | 'Video' | 'Tiện ích';
export const TOOL_TAGS: ToolTag[] = ['Tất cả', 'Facebook', 'Video', 'Tiện ích'];
export const TAG_KEY: Record<ToolTag, string> = {
  'Tất cả': 'tag.all',
  Facebook: 'tag.facebook',
  Video: 'tag.video',
  'Tiện ích': 'tag.util',
};

const VIDEO_KEYS = new Set([
  'fb-video-carousel', 'fb-one-card-video-carousel', 'fb-one-card-picture-carousel',
  'post-a-card', 'swipe-up-video', 'up-to-reelsv2', 'up-to-stories',
]);

export interface GridTool extends ToolItem {
  tag: Exclude<ToolTag, 'Tất cả'>;
}

// Công cụ + tiện ích (API Client, Trình duyệt) để hiển thị trong lưới.
const GRID_TOOLS: GridTool[] = [
  ...TOOLS.map((it) => ({ ...it, tag: (VIDEO_KEYS.has(it.key) ? 'Video' : 'Facebook') as GridTool['tag'] })),
  { key: 'api-client', title: 'API Client', desc: 'Gửi request như Postman.', category: 'Phân tích', icon: 'flash', route: '/api-client', tag: 'Tiện ích', en: { title: 'API Client', desc: 'Send requests like Postman.' } },
  { key: 'browser', title: 'Trình duyệt', desc: 'Trình duyệt web tích hợp.', category: 'Phân tích', icon: 'globe', route: '/browser', tag: 'Tiện ích', en: { title: 'Browser', desc: 'Built-in web browser.' } },
];

// Bảng màu ô (xoay vòng) — mô phỏng lưới nhiều màu của thiết kế.
const TILE_COLORS = ['#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6', '#f59e0b', '#ef4444', '#6366f1', '#0ea5e9', '#84cc16'];

function tileColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return TILE_COLORS[h % TILE_COLORS.length];
}

export function findGridTool(key: string): GridTool | undefined {
  return GRID_TOOLS.find((t) => t.key === key);
}

function ToolTile({ item }: { item: GridTool }) {
  const c = useColors();
  const text = useToolText()(item);
  const color = item.route ? tileColor(item.key) : c.faint;
  return (
    <Pressable onPress={() => openTool(item, text.title)} style={({ pressed }) => [gridStyles.tile, { opacity: pressed ? 0.75 : 1 }]}>
      <View style={[gridStyles.tileIcon, { backgroundColor: color + '22' }]}>
        <Ionicons name={item.icon} size={26} color={color} />
        {!item.route ? (
          <View style={[gridStyles.soonDot, { backgroundColor: c.card, borderColor: c.border }]}>
            <Ionicons name="time" size={11} color={c.faint} />
          </View>
        ) : null}
      </View>
      <Text numberOfLines={2} style={[gridStyles.tileLabel, { color: c.text }]}>{text.title}</Text>
    </Pressable>
  );
}

/** Lưới công cụ 3 cột, lọc theo tag + từ khóa. */
export function ToolGrid({ tag = 'Tất cả', query = '' }: { tag?: ToolTag; query?: string }) {
  const t = useT();
  const toolText = useToolText();
  const q = query.trim().toLowerCase();
  const items = GRID_TOOLS.filter((it) => {
    if (tag !== 'Tất cả' && it.tag !== tag) return false;
    if (q === '') return true;
    const { title, desc } = toolText(it);
    return title.toLowerCase().includes(q) || desc.toLowerCase().includes(q);
  });
  if (items.length === 0) {
    return <Body muted size={14}>{t('tools.notFound')}</Body>;
  }
  return (
    <View style={gridStyles.grid}>
      {items.map((it) => (
        <ToolTile key={it.key} item={it} />
      ))}
    </View>
  );
}

const gridStyles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  tile: { width: '33.333%', paddingHorizontal: 6, paddingVertical: 10, alignItems: 'center', gap: 8 },
  tileIcon: { width: 60, height: 60, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  soonDot: { position: 'absolute', top: -4, right: -4, width: 20, height: 20, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontSize: 12, fontWeight: '600', textAlign: 'center', lineHeight: 15 },
});
