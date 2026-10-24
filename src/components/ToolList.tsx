import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Badge, Body, Card, IconCircle, Row, Title, radius, useColors } from '@/components/ui';
import { useT } from '@/lib/i18n';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
type Category = 'Tự động hóa' | 'Tạo nội dung' | 'Phân tích' | 'Quản lý';
type Tone = 'accent' | 'info' | 'success' | 'danger' | 'muted';

export interface ToolItem {
  key: string;
  /** i18n key (xem src/lib/locales/*.ts, namespace `tool.<key>.title`) — đủ cả 8 ngôn ngữ. */
  titleKey: string;
  descKey: string;
  category: Category;
  icon: IconName;
  /** Route thật nếu đã làm xong; bỏ trống = "Sắp có". */
  route?: Href;
}

// Toàn bộ công cụ port từ metus-few (3 cái đầu đã hoạt động, còn lại làm sau).
export const TOOLS: ToolItem[] = [
  // ----- Tự động hóa -----
  { key: 'auto-join', titleKey: 'tool.autoJoin.title', descKey: 'tool.autoJoin.desc', category: 'Tự động hóa', icon: 'people', route: '/tools/auto-join-fb-group' },
  { key: 'auto-post', titleKey: 'tool.autoPost.title', descKey: 'tool.autoPost.desc', category: 'Tự động hóa', icon: 'create', route: '/tools/auto-post-fb-group' },
  { key: 'auto-comment', titleKey: 'tool.autoComment.title', descKey: 'tool.autoComment.desc', category: 'Tự động hóa', icon: 'chatbubble-ellipses', route: '/tools/auto-comment-fb-group' },
  { key: 'page-comments-bot', titleKey: 'tool.pageCommentsBot.title', descKey: 'tool.pageCommentsBot.desc', category: 'Tự động hóa', icon: 'chatbubbles' },
  { key: 'auto-leave-group', titleKey: 'tool.autoLeaveGroup.title', descKey: 'tool.autoLeaveGroup.desc', category: 'Tự động hóa', icon: 'exit' },
  { key: 'up-to-reelsv2', titleKey: 'tool.upToReelsv2.title', descKey: 'tool.upToReelsv2.desc', category: 'Tự động hóa', icon: 'film', route: '/tools/up-to-reelsv2' },
  { key: 'up-to-stories', titleKey: 'tool.upToStories.title', descKey: 'tool.upToStories.desc', category: 'Tự động hóa', icon: 'albums', route: '/tools/up-to-stories' },
  { key: 'page-posts-clone', titleKey: 'tool.pagePostsClone.title', descKey: 'tool.pagePostsClone.desc', category: 'Tự động hóa', icon: 'copy' },
  { key: 'fb-carousel-deep-clone', titleKey: 'tool.fbCarouselDeepClone.title', descKey: 'tool.fbCarouselDeepClone.desc', category: 'Tự động hóa', icon: 'copy' },
  { key: 'logo', titleKey: 'tool.logo.title', descKey: 'tool.logo.desc', category: 'Tự động hóa', icon: 'color-palette' },

  // ----- Tạo nội dung -----
  { key: 'fb-video-carousel', titleKey: 'tool.fbVideoCarousel.title', descKey: 'tool.fbVideoCarousel.desc', category: 'Tạo nội dung', icon: 'videocam', route: '/tools/fb-video-carousel' },
  { key: 'fb-one-card-video-carousel', titleKey: 'tool.fbOneCardVideoCarousel.title', descKey: 'tool.fbOneCardVideoCarousel.desc', category: 'Tạo nội dung', icon: 'videocam', route: '/tools/fb-one-card-video-carousel' },
  { key: 'fb-one-card-picture-carousel', titleKey: 'tool.fbOneCardPictureCarousel.title', descKey: 'tool.fbOneCardPictureCarousel.desc', category: 'Tạo nội dung', icon: 'image', route: '/tools/fb-one-card-picture-carousel' },
  { key: 'post-a-card', titleKey: 'tool.postACard.title', descKey: 'tool.postACard.desc', category: 'Tạo nội dung', icon: 'card', route: '/tools/post-a-card' },
  { key: 'swipe-up-video', titleKey: 'tool.swipeUpVideo.title', descKey: 'tool.swipeUpVideo.desc', category: 'Tạo nội dung', icon: 'arrow-up-circle', route: '/tools/swipe-up-video' },
  { key: 'page-pics-posts', titleKey: 'tool.pagePicsPosts.title', descKey: 'tool.pagePicsPosts.desc', category: 'Tạo nội dung', icon: 'images' },
  { key: 'page-multi-photo-post', titleKey: 'tool.pageMultiPhotoPost.title', descKey: 'tool.pageMultiPhotoPost.desc', category: 'Tạo nội dung', icon: 'images' },
  { key: 'timeline-post', titleKey: 'tool.timelinePost.title', descKey: 'tool.timelinePost.desc', category: 'Tạo nội dung', icon: 'person-circle' },
  { key: 'create-bm-pages', titleKey: 'tool.createBmPages.title', descKey: 'tool.createBmPages.desc', category: 'Tạo nội dung', icon: 'duplicate' },

  // ----- Phân tích -----
  { key: 'group-extractor', titleKey: 'tool.groupExtractor.title', descKey: 'tool.groupExtractor.desc', category: 'Phân tích', icon: 'download', route: '/tools/group-extractor-by-uid' },
  { key: 'group-search-by-keyword', titleKey: 'tool.groupSearchByKeyword.title', descKey: 'tool.groupSearchByKeyword.desc', category: 'Phân tích', icon: 'search' },
  { key: 'post-extractor-by-uid', titleKey: 'tool.postExtractorByUid.title', descKey: 'tool.postExtractorByUid.desc', category: 'Phân tích', icon: 'document-text' },
  // route "as Href": file vừa thêm, types chưa kịp tái sinh (expo-router typegen theo Metro watcher).
  { key: 'group-posts-analyze', titleKey: 'tool.groupPostsAnalyze.title', descKey: 'tool.groupPostsAnalyze.desc', category: 'Phân tích', icon: 'bar-chart', route: '/tools/group-post-analysis' as Href },
  // route "as Href": file vừa thêm, types chưa kịp tái sinh (expo-router typegen theo Metro watcher).
  { key: 'page-posts-analyze', titleKey: 'tool.pagePostsAnalyze.title', descKey: 'tool.pagePostsAnalyze.desc', category: 'Phân tích', icon: 'stats-chart', route: '/tools/page-post-analysis' as Href },
  { key: 'friends', titleKey: 'tool.friends.title', descKey: 'tool.friends.desc', category: 'Phân tích', icon: 'people-circle' },

  // ----- Quản lý -----
  { key: 'admin-groups-manager', titleKey: 'tool.adminGroupsManager.title', descKey: 'tool.adminGroupsManager.desc', category: 'Quản lý', icon: 'shield-checkmark' },
  { key: 'fb-share-to-pages', titleKey: 'tool.fbShareToPages.title', descKey: 'tool.fbShareToPages.desc', category: 'Quản lý', icon: 'share-social' },
  { key: 'page-posts-hide', titleKey: 'tool.pagePostsHide.title', descKey: 'tool.pagePostsHide.desc', category: 'Quản lý', icon: 'eye-off' },
  { key: 'page-posts-remover', titleKey: 'tool.pagePostsRemover.title', descKey: 'tool.pagePostsRemover.desc', category: 'Quản lý', icon: 'trash' },
  { key: 'group-posts-remover', titleKey: 'tool.groupPostsRemover.title', descKey: 'tool.groupPostsRemover.desc', category: 'Quản lý', icon: 'trash' },
  // route "as Href": file vừa thêm, types chưa kịp tái sinh (expo-router typegen theo Metro watcher).
  { key: 'group-pending-post-remover', titleKey: 'tool.groupPendingPostRemover.title', descKey: 'tool.groupPendingPostRemover.desc', category: 'Quản lý', icon: 'trash-bin', route: '/tools/group-pending-post-remover' as Href },
  { key: 'group-posts-spam-remover', titleKey: 'tool.groupPostsSpamRemover.title', descKey: 'tool.groupPostsSpamRemover.desc', category: 'Quản lý', icon: 'trash-bin' },
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

/** Text công cụ theo ngôn ngữ hiện tại — dịch qua i18n (xem src/lib/locales/*.ts). */
export function useToolText(): (item: ToolItem) => { title: string; desc: string } {
  const t = useT();
  return (item) => ({ title: t(item.titleKey), desc: t(item.descKey) });
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
  { key: 'api-client', titleKey: 'tool.apiClient.title', descKey: 'tool.apiClient.desc', category: 'Phân tích', icon: 'flash', route: '/api-client', tag: 'Tiện ích' },
  { key: 'browser', titleKey: 'tool.browser.title', descKey: 'tool.browser.desc', category: 'Phân tích', icon: 'globe', route: '/browser', tag: 'Tiện ích' },
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
