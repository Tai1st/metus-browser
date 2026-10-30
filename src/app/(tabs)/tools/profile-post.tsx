import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Image, Linking, Modal, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PickerModal } from '@/components/AdPostTool';
import { ToolGate } from '@/components/tool';
import { Badge, Body, Button, Card, Field, Label, Row, Screen, radius, shadow, useColors } from '@/components/ui';
import { describeError } from '@/lib/api';
import { useFbAccounts } from '@/lib/fb/accounts';
import {
  createComment,
  getGroups,
  getTextFormatPresets,
  uploadGroupImage,
  uploadGroupVideo,
  type GroupItem,
  type LocalFile,
  type TextFormatPreset,
} from '@/lib/fb/Group';
import { createProfilePost, likeProfilePost } from '@/lib/fb/profilePost';
import { useT } from '@/lib/i18n';
import { pickMedia as chooseMedia } from '@/lib/pickMedia';

const QUICK_COLORS: { color: string; presetId: string }[] = [
  { color: '#ffffff', presetId: '' },
  { color: '#c600ff', presetId: '106018623298955' },
  { color: '#e2013b', presetId: '1903718606535395' },
  { color: '#111111', presetId: '1881421442117417' },
  { color: '#ff0047', presetId: '249307305544279' },
];

interface LocalPhoto {
  uri: string;
  name: string;
  mimeType?: string;
}

/** Modal chọn nền đầy đủ (ranked + theo danh mục) — giống bản web. */
function BgPresetModal({ visible, onClose, data, loading, selectedId, onSelect }: {
  visible: boolean; onClose: () => void; data: { ranked: TextFormatPreset[]; categories: { name: string; presets: TextFormatPreset[] }[] } | null;
  loading: boolean; selectedId?: string; onSelect: (p: TextFormatPreset) => void;
}) {
  const c = useColors();
  const t = useT();
  const insets = useSafeAreaInsets();
  const sections = data ? [{ name: t('profilePost.mostUsed'), presets: data.ranked }, ...data.categories] : [];
  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={onClose} />
        <View style={{ backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: Math.max(insets.bottom, 16), maxHeight: '75%' }}>
        <View style={{ alignItems: 'center', paddingTop: 10 }}><View style={{ width: 42, height: 5, borderRadius: 3, backgroundColor: c.border }} /></View>
        <Row style={{ justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14 }}>
          <Body weight="700" size={17}>{t('profilePost.chooseBackground')}</Body>
          <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={22} color={c.faint} /></Pressable>
        </Row>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
          {loading ? (
            <Row gap={10}><ActivityIndicator color={c.accent} /><Body muted>…</Body></Row>
          ) : !data || sections.every((s) => s.presets.length === 0) ? (
            <Body muted size={13}>{t('profilePost.noPresets')}</Body>
          ) : (
            sections.filter((s) => s.presets.length).map((s) => (
              <View key={s.name} style={{ gap: 8 }}>
                <Label>{s.name}</Label>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {s.presets.map((p) => {
                    const active = selectedId === p.id;
                    const img = p.image || p.thumb;
                    return (
                      <Pressable key={p.id} onPress={() => onSelect(p)}
                        style={{ width: 60, height: 60, borderRadius: 8, overflow: 'hidden', borderWidth: active ? 2.5 : 0, borderColor: c.accent, backgroundColor: img ? c.chip : p.color }}>
                        {img ? <Image source={{ uri: img }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : null}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))
          )}
        </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Runner({ dtsg, fbId }: { dtsg: string; fbId: string }) {
  const c = useColors();
  const t = useT();
  const { current: fbAccount } = useFbAccounts();

  const [content, setContent] = useState('');
  const [bgColor, setBgColor] = useState('#ffffff');
  const [bgImage, setBgImage] = useState<string | undefined>();
  const [presetId, setPresetId] = useState<string | undefined>();
  const [presetData, setPresetData] = useState<{ ranked: TextFormatPreset[]; categories: { name: string; presets: TextFormatPreset[] }[] } | null>(null);
  const [loadingPresets, setLoadingPresets] = useState(false);
  const [bgModal, setBgModal] = useState(false);

  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [video, setVideo] = useState<LocalPhoto | null>(null);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [uploadedVideoId, setUploadedVideoId] = useState<string | undefined>();

  const [reshareToStory, setReshareToStory] = useState(false);
  const [autoLike, setAutoLike] = useState(false);
  const [crossPost, setCrossPost] = useState(false);
  const [groupPicker, setGroupPicker] = useState(false);
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [autoComment, setAutoComment] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentPhoto, setCommentPhoto] = useState<LocalFile | null>(null);

  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const [resultPostId, setResultPostId] = useState<string | null>(null);

  const loadPresets = async () => {
    setBgModal(true);
    if (presetData || loadingPresets) return;
    setLoadingPresets(true);
    try {
      setPresetData(await getTextFormatPresets(dtsg, fbId));
    } catch {
      // im lặng — vẫn còn 5 màu nhanh để dùng
    } finally {
      setLoadingPresets(false);
    }
  };

  const selectPreset = (p: TextFormatPreset) => {
    setBgColor(p.color);
    setBgImage(p.image || p.thumb);
    setPresetId(p.id);
    setBgModal(false);
  };

  const selectQuickColor = (color: string, pid: string) => {
    setBgColor(color);
    setBgImage(undefined);
    setPresetId(pid || undefined);
  };

  const loadGroups = async () => {
    setGroupsLoading(true);
    try {
      setGroups(await getGroups(dtsg, fbId));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setGroupsLoading(false);
    }
  };

  const toggleCrossPost = (v: boolean) => {
    setCrossPost(v);
    if (v && groups.length === 0 && !groupsLoading) loadGroups();
  };

  const toggleGroup = (id: string) => setSelectedGroupIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const pickPhotos = async () => {
    const assets = await chooseMedia('image', true);
    if (!assets.length) return;
    setVideo(null);
    setUploadedVideoId(undefined);
    setPhotos((prev) => [...prev, ...assets.map((a) => ({ uri: a.uri, name: a.name, mimeType: a.mimeType }))]);
  };

  const pickVideo = async () => {
    const [a] = await chooseMedia('video');
    if (!a) return;
    setPhotos([]);
    const v = { uri: a.uri, name: a.name, mimeType: a.mimeType };
    setVideo(v);
    setUploadingVideo(true);
    setError('');
    try {
      const videoId = await uploadGroupVideo({ dtsg, fbId, file: v, composerEntryPointRef: 'timeline' });
      setUploadedVideoId(videoId);
    } catch (e) {
      setError(describeError(e));
      setVideo(null);
    } finally {
      setUploadingVideo(false);
    }
  };

  const removePhoto = (i: number) => setPhotos((prev) => prev.filter((_, idx) => idx !== i));
  const removeVideo = () => {
    setVideo(null);
    setUploadedVideoId(undefined);
  };

  const pickCommentPhoto = async () => {
    const [a] = await chooseMedia('image');
    if (!a) return;
    setCommentPhoto({ uri: a.uri, name: a.name, type: a.mimeType });
  };

  const submit = async () => {
    if (!content.trim() && photos.length === 0 && !video) {
      setError(t('profilePost.err.empty'));
      return;
    }
    if (video && !uploadedVideoId) {
      setError(t('profilePost.err.videoUploading'));
      return;
    }
    setPosting(true);
    setError('');
    setResultPostId(null);
    try {
      const photoIds: string[] = [];
      if (!video) {
        for (const ph of photos) {
          const url = await uploadGroupImage({ dtsg, fbId, file: ph });
          photoIds.push(url);
        }
      }
      const { postId } = await createProfilePost({
        dtsg, fbId, text: content,
        photoIds, videoId: uploadedVideoId,
        textFormatPresetId: presetId,
        reshareToStory,
        groupIds: crossPost ? selectedGroupIds : undefined,
      });
      if (!postId) throw new Error(t('profilePost.err.create'));
      setResultPostId(postId);

      if (autoComment && commentText.trim()) {
        try {
          await createComment({ dtsg, fbId, postId, text: commentText.trim(), photo: commentPhoto });
        } catch {
          // bài vẫn coi là đăng thành công, chỉ bình luận lỗi
        }
      }
      if (autoLike) {
        likeProfilePost(dtsg, fbId, postId).catch(() => {});
      }

      setContent('');
      setPhotos([]);
      removeVideo();
      setCommentText('');
      setCommentPhoto(null);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setPosting(false);
    }
  };

  const hasBg = bgColor !== '#ffffff' || !!bgImage;

  return (
    <>
      <Card>
        <Row gap={10} style={{ alignItems: 'center' }}>
          {fbAccount?.picture ? (
            <Image source={{ uri: fbAccount.picture }} style={{ width: 40, height: 40, borderRadius: 20 }} />
          ) : (
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.chip, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="person" size={20} color={c.faint} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Body weight="700" size={14} numberOfLines={1}>{fbAccount?.name || t('profilePost.account')}</Body>
            <Body muted size={11}>{fbId}</Body>
          </View>
        </Row>
      </Card>

      <Card padded={false}>
        <View style={{ padding: 16, gap: 12 }}>
          <View style={[{ minHeight: 140, borderRadius: radius.md, overflow: 'hidden', backgroundColor: hasBg ? bgColor : c.input }, !hasBg && { borderWidth: 1, borderColor: c.inputBorder }]}>
            {bgImage ? <Image source={{ uri: bgImage }} style={{ position: 'absolute', width: '100%', height: '100%' }} resizeMode="cover" /> : null}
            <View style={{ flex: 1, padding: 12, justifyContent: hasBg ? 'center' : 'flex-start' }}>
              <Field
                value={content}
                onChangeText={setContent}
                placeholder={t('profilePost.contentPlaceholder')}
                placeholderTextColor={hasBg ? 'rgba(255,255,255,0.8)' : undefined}
                multiline
                style={hasBg ? { backgroundColor: 'transparent', color: '#fff', fontWeight: '700', fontSize: 18, textAlign: 'center' } : { backgroundColor: 'transparent' }}
              />
            </View>
          </View>

          <Row gap={8} style={{ alignItems: 'center' }}>
            {QUICK_COLORS.map((qc) => (
              <Pressable key={qc.color} onPress={() => selectQuickColor(qc.color, qc.presetId)}
                style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: qc.color, borderWidth: bgColor === qc.color && !bgImage ? 2.5 : 1, borderColor: bgColor === qc.color && !bgImage ? c.accent : c.border }} />
            ))}
            <Pressable onPress={loadPresets} style={{ width: 32, height: 32, borderRadius: 8, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.faint, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="add" size={16} color={c.faint} />
            </Pressable>
          </Row>
        </View>
      </Card>

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Label>{video ? t('profilePost.videoLabel') : t('profilePost.photosLabel', { n: photos.length })}</Label>
          <Row gap={8}>
            <Button compact variant="secondary" icon="image" title={t('profilePost.addPhotos')} onPress={pickPhotos} disabled={!!video} />
            <Button compact variant="secondary" icon="videocam" title={t('profilePost.addVideo')} onPress={pickVideo} disabled={photos.length > 0 || uploadingVideo} />
          </Row>
        </Row>

        {video ? (
          <View style={{ width: 140, aspectRatio: 9 / 16, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: '#000' }}>
            <Image source={{ uri: video.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            {uploadingVideo ? (
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <ActivityIndicator color="#fff" />
                <Text style={{ color: '#fff', fontSize: 11 }}>{t('profilePost.uploadingVideo')}</Text>
              </View>
            ) : uploadedVideoId ? (
              <View style={{ position: 'absolute', top: 6, left: 6 }}><Badge text={t('profilePost.videoReady')} tone="success" /></View>
            ) : null}
            <Pressable onPress={removeVideo} style={{ position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="close" size={14} color="#fff" />
            </Pressable>
          </View>
        ) : photos.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {photos.map((ph, i) => (
              <View key={ph.uri + i} style={{ width: 80, height: 80, borderRadius: radius.sm, overflow: 'hidden' }}>
                <Image source={{ uri: ph.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                <Pressable onPress={() => removePhoto(i)} style={{ position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="close" size={12} color="#fff" />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
      </Card>

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Body weight="600" size={14}>{t('profilePost.reshareToStory')}</Body>
          <Switch value={reshareToStory} onValueChange={setReshareToStory} trackColor={{ true: c.accent }} />
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <Body weight="600" size={14}>{t('profilePost.crossPost')}</Body>
          <Switch value={crossPost} onValueChange={toggleCrossPost} trackColor={{ true: c.accent }} />
        </Row>
        {crossPost ? (
          <>
            <Body muted size={12}>{t('profilePost.crossPostHint')}</Body>
            <Pressable onPress={() => setGroupPicker(true)} style={[{ borderWidth: 1, borderColor: c.inputBorder, borderRadius: radius.sm, padding: 12 }, shadow(c, 1)]}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                {groupsLoading ? <Body muted size={13}>…</Body> : <Body size={13}>{t('profilePost.nGroupsSelected', { n: selectedGroupIds.length })}</Body>}
                <Ionicons name="chevron-forward" size={18} color={c.faint} />
              </Row>
            </Pressable>
          </>
        ) : null}
        <Row style={{ justifyContent: 'space-between' }}>
          <Body weight="600" size={14}>{t('profilePost.autoLike')}</Body>
          <Switch value={autoLike} onValueChange={setAutoLike} trackColor={{ true: c.accent }} />
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <Body weight="600" size={14}>{t('profilePost.autoComment')}</Body>
          <Switch value={autoComment} onValueChange={setAutoComment} trackColor={{ true: c.accent }} />
        </Row>
        {autoComment ? (
          <>
            <Field value={commentText} onChangeText={setCommentText} placeholder={t('profilePost.commentPlaceholder')} multiline />
            <Row gap={10} style={{ alignItems: 'center' }}>
              <Button compact variant="secondary" icon="image" title={t('profilePost.addCommentImage')} onPress={pickCommentPhoto} />
              {commentPhoto ? (
                <View style={{ width: 36, height: 36, borderRadius: radius.sm, overflow: 'hidden' }}>
                  <Image source={{ uri: commentPhoto.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                </View>
              ) : null}
            </Row>
          </>
        ) : null}
      </Card>

      {error ? <Body color={c.danger} size={13}>{error}</Body> : null}
      {resultPostId ? (
        <Card onPress={() => Linking.openURL(`https://facebook.com/${resultPostId}`)}>
          <Row gap={10} style={{ alignItems: 'center' }}>
            <Ionicons name="checkmark-circle" size={20} color={c.success} />
            <Body size={13} weight="600">{t('profilePost.success')}</Body>
            <View style={{ flex: 1 }} />
            <Ionicons name="open-outline" size={16} color={c.faint} />
          </Row>
        </Card>
      ) : null}

      <Button title={posting ? t('profilePost.publishing') : t('profilePost.submit')} icon="send" onPress={submit} loading={posting} full />

      <BgPresetModal visible={bgModal} onClose={() => setBgModal(false)} data={presetData} loading={loadingPresets} selectedId={presetId} onSelect={selectPreset} />
      <PickerModal visible={groupPicker} title={t('profilePost.chooseGroups')} onClose={() => setGroupPicker(false)} items={groups} multi
        keyOf={(g) => g.id} labelOf={(g) => g.name} avatarOf={(g) => g.picture} selectedKeys={selectedGroupIds}
        onToggle={(g) => toggleGroup(g.id)} />
    </>
  );
}

export default function ProfilePostScreen() {
  return (
    <Screen>
      <ToolGate require="package">{(dtsg, fbId) => <Runner dtsg={dtsg} fbId={fbId} />}</ToolGate>
    </Screen>
  );
}
