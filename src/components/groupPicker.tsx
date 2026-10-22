/**
 * Chọn nhóm (danh sách / nhập UID nhóm / nhập UID bài viết) — port GroupList của
 * metus-few, dùng chung cho tool đăng bài nhóm và bình luận nhóm.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';

import { Badge, Body, Card, Field, Label, Row, Segmented, radius, useColors } from '@/components/ui';
import type { GroupItem } from '@/lib/fb/Group';
import { useT } from '@/lib/i18n';

/** Lấy group id từ URL hoặc UID thô. */
export function parseGroupId(line: string): string | null {
  const s = line.trim();
  if (!s) return null;
  const m = s.match(/groups\/(?:[^/]*-)?(\d+)/) || s.match(/groups\/([A-Za-z0-9.]+)/);
  if (m) return m[1];
  if (/^\d+$/.test(s)) return s;
  return null;
}


// ───────────────────────────── Chọn nhóm ─────────────────────────────

export const GROUPS_PER_PAGE = 10;

/** Số trang hiển thị: 1 2 3 4 … N (giống GroupList của metus-few). */
export function pagesToShow(cur: number, total: number): (number | '…')[] {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);
  if (cur < 4) return [1, 2, 3, 4, '…', total];
  if (cur > total - 3) return [1, '…', total - 3, total - 2, total - 1, total];
  return [1, '…', cur - 1, cur, cur + 1, '…', total];
}

export function Pager({ page, total, onChange }: { page: number; total: number; onChange: (p: number) => void }) {
  const c = useColors();
  const btn = (key: string, content: React.ReactNode, onPress?: () => void, active = false, disabled = false) => (
    <Pressable key={key} disabled={disabled || !onPress} onPress={onPress}
      style={{ minWidth: 32, height: 32, paddingHorizontal: 6, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
        backgroundColor: active ? c.accent : 'transparent', borderWidth: active ? 0 : 1, borderColor: c.border, opacity: disabled ? 0.4 : 1 }}>
      {content}
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 4 }}>
      {btn('prev', <Ionicons name="chevron-back" size={16} color={c.text} />, () => onChange(page - 1), false, page <= 1)}
      {pagesToShow(page, total).map((p, i) =>
        p === '…'
          ? <Text key={`e${i}`} style={{ color: c.faint, paddingHorizontal: 2 }}>…</Text>
          : btn(`p${p}`, <Text style={{ fontWeight: '700', fontSize: 13, color: p === page ? '#fff' : c.text }}>{p}</Text>, () => onChange(p), p === page),
      )}
      {btn('next', <Ionicons name="chevron-forward" size={16} color={c.text} />, () => onChange(page + 1), false, page >= total)}
    </View>
  );
}

export interface PostModeProps {
  active: boolean;
  setActive: (v: boolean) => void;
  raw: string;
  setRaw: (v: string) => void;
  valid: number;
  invalid: string[];
  pendingLinks: number;
  resolving: boolean;
  errors: string[];
}

export function GroupPicker({ groups, loading, onReload, selected, setSelected, manual, setManual, manualRaw, setManualRaw, disabled, post }: {
  groups: GroupItem[]; loading: boolean; onReload: () => void; selected: string[]; setSelected: (ids: string[]) => void;
  manual: boolean; setManual: (v: boolean) => void; manualRaw: string; setManualRaw: (v: string) => void; disabled: boolean;
  /** Chế độ "Nhập UID bài viết" (tool bình luận). */
  post?: PostModeProps;
}) {
  const c = useColors();
  const t = useT();
  const [tab, setTab] = useState<'all' | 'selected' | 'admin'>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return groups
      .filter((g) => !kw || g.name.toLowerCase().includes(kw) || g.id.includes(kw))
      .filter((g) => (tab === 'selected' ? selected.includes(g.id) : tab === 'admin' ? g.isAdmin : true));
  }, [groups, q, tab, selected]);
  useEffect(() => setPage(1), [q, tab, groups]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / GROUPS_PER_PAGE));
  const curPage = Math.min(page, totalPages);
  const toggle = (id: string) => setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const allFilteredSelected = filtered.length > 0 && filtered.every((g) => selected.includes(g.id));

  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <Label>{post?.active ? t('gp.postTargets', { n: post.valid }) : t('gp.groups', { info: manual ? t('gp.manualShort') : `${selected.length}/${groups.length}` })}</Label>
        {!manual && !post?.active ? (
          <Pressable onPress={onReload} hitSlop={8} disabled={loading}>
            {loading ? <ActivityIndicator color={c.accent} /> : <Ionicons name="refresh" size={18} color={c.faint} />}
          </Pressable>
        ) : null}
      </Row>
      {post ? (
        <Segmented value={post.active ? 'post' : manual ? 'manual' : 'list'} options={['list', 'manual', 'post'] as const}
          labelFor={(v) => t(v === 'manual' ? 'gp.modeManual' : v === 'post' ? 'gp.modePost' : 'gp.modeList')}
          onChange={(v) => { if (disabled) return; setManual(v === 'manual'); post.setActive(v === 'post'); }} />
      ) : (
        <Segmented value={manual ? 'manual' : 'list'} options={['list', 'manual'] as const} labelFor={(v) => t(v === 'manual' ? 'gp.modeManual' : 'gp.modeList')} onChange={(v) => !disabled && setManual(v === 'manual')} />
      )}
      {post?.active ? (
        <View style={{ gap: 6 }}>
          <Field label={t('gp.postUidHint')} value={post.raw} onChangeText={post.setRaw} multiline editable={!disabled} autoCapitalize="none"
            placeholder={'123456789_987654321\nhttps://www.facebook.com/groups/abc/posts/123'} />
          <Row gap={10} style={{ flexWrap: 'wrap' }}>
            <Body size={12} color={c.success} weight="600">{t('gp.postValid', { n: post.valid })}</Body>
            {post.resolving ? (
              <Row gap={4}><ActivityIndicator size="small" color={c.accent} /><Body size={12} muted>{t('gp.resolvingLinks', { n: post.pendingLinks })}</Body></Row>
            ) : post.pendingLinks ? <Body size={12} muted>🔗 {t('gp.linksPending', { n: post.pendingLinks })}</Body> : null}
          </Row>
          {post.invalid.length ? <Body size={12} color={c.danger}>⚠️ {t('gp.invalidUids', { n: post.invalid.length })} {post.invalid.slice(0, 5).join(', ')}</Body> : null}
          {post.errors.length ? <Body size={12} color={c.danger}>⚠️ {t('gp.resolveFailed', { n: post.errors.length })} {post.errors.slice(0, 3).join(', ')}</Body> : null}
        </View>
      ) : manual ? (
        <Field
          label={t('gp.manualLabel')}
          value={manualRaw}
          onChangeText={setManualRaw}
          multiline
          editable={!disabled}
          autoCapitalize="none"
          placeholder={'123456789\nhttps://www.facebook.com/groups/abc-987654321'}
        />
      ) : (
        <>
          {/* Tab gạch chân kèm số lượng (giống GroupList của metus-few) */}
          <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: c.border }}>
            {([
              ['all', t('gp.tabAll'), groups.length],
              ['selected', t('gp.tabSelected'), selected.length],
              ['admin', t('gp.tabAdmin'), groups.filter((g) => g.isAdmin).length],
            ] as const).map(([k, label, n]) => {
              const on = tab === k;
              return (
                <Pressable key={k} onPress={() => setTab(k)} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, marginBottom: -1, borderBottomWidth: 2, borderColor: on ? c.accent : 'transparent' }}>
                  <Text style={{ fontSize: 13.5, fontWeight: on ? '700' : '500', color: on ? c.accent : c.muted }}>{label} ({n})</Text>
                </Pressable>
              );
            })}
          </View>
          <Field icon="search" value={q} onChangeText={setQ} placeholder={t('gp.search')} autoCapitalize="none" />
          <Row style={{ justifyContent: 'space-between' }}>
            <Body muted size={12}>{t('gp.count', { n: filtered.length })}</Body>
            <Pressable
              disabled={disabled || !filtered.length}
              onPress={() => {
                const ids = filtered.map((g) => g.id);
                setSelected(allFilteredSelected ? selected.filter((id) => !ids.includes(id)) : Array.from(new Set([...selected, ...ids])));
              }}>
              <Body size={13} weight="700" color={c.accent}>{t(allFilteredSelected ? 'gp.unselectAll' : 'gp.selectAll')}</Body>
            </Pressable>
          </Row>
          {loading && !groups.length ? (
            <Row gap={10}><ActivityIndicator color={c.accent} /><Body muted>{t('gp.loadingGroups')}</Body></Row>
          ) : (
            <View style={{ gap: 6 }}>
              {filtered.slice((curPage - 1) * GROUPS_PER_PAGE, curPage * GROUPS_PER_PAGE).map((g) => {
                const on = selected.includes(g.id);
                return (
                  <Pressable key={g.id} disabled={disabled} onPress={() => toggle(g.id)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: on ? c.accent : c.border, backgroundColor: on ? c.accentSoft : c.card }}>
                    <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? c.accent : c.faint} />
                    {g.picture ? <Image source={{ uri: g.picture }} style={{ width: 32, height: 32, borderRadius: 8 }} /> : <Ionicons name="people" size={24} color={c.faint} />}
                    <View style={{ flex: 1 }}>
                      <Body weight="600" size={14} numberOfLines={1}>{g.name}</Body>
                      <Body muted size={11}>{g.id}</Body>
                    </View>
                    {g.isAdmin ? <Badge text="Admin" tone="info" /> : null}
                  </Pressable>
                );
              })}
              {totalPages > 1 ? <Pager page={curPage} total={totalPages} onChange={setPage} /> : null}
            </View>
          )}
        </>
      )}
    </Card>
  );
}
