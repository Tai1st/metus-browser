import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, Text, View } from 'react-native';

import { LinkVideoModal, PickerModal, SelectorRow } from '@/components/AdPostTool';
import { ResultList, ToolGate } from '@/components/tool';
import { Badge, Body, Button, Card, Field, GradientText, Label, Row, Screen, radius, shadow, useColors } from '@/components/ui';
import { describeError } from '@/lib/api';
import { useAdsSession } from '@/lib/fb/adsSession';
import type { AdAccount } from '@/lib/fb/ads';
import {
  type Canvas,
  createCanvasElement,
  createCanvasFromElements,
  createSwipeUpCreative,
  getCanvasName,
  getCanvasThumbnail,
  getCreativeStoryId,
  getPageCanvases,
  getPhotoIdFromImageUrl,
  getVideoThumbnailChoices,
  publishCanvas,
  publishSwipeUpStory,
  uploadCanvasImage,
} from '@/lib/fb/swipeUpVideo';
import { uploadAdVideo } from '@/lib/fb/videoCarousel';
import { uploadAdVideoFromLink } from '@/lib/fb/videoFromLink';
import { useT } from '@/lib/i18n';
import { pickMedia as chooseMedia } from '@/lib/pickMedia';

// Nền chung (không chữ) cho ô chọn video khi chưa có nội dung — chữ đè lên bằng i18n
// nên dùng chung 1 ảnh cho mọi ngôn ngữ, không cần tạo file ảnh riêng theo locale.
const UPLOAD_BG = require('../../../../assets/images/upload-video-bg.png');

function SwipeChevron({ c }: { c: ReturnType<typeof useColors> }) {
  return (
    <View style={{ position: 'absolute', top: -14, left: 0, right: 0, alignItems: 'center' }}>
      <View style={[{ width: 28, height: 28, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' }, shadow(c, 1)]}>
        <Ionicons name="chevron-up" size={16} color={c.faint} />
      </View>
    </View>
  );
}

type PostRow = { pageId: string; pageName: string; pagePicture?: string; status: 'pending' | 'done' | 'error'; note?: string };

function Runner({ dtsg, fbId }: { dtsg: string; fbId: string }) {
  const c = useColors();
  const t = useT();
  const { ads, loading, error: adsError, reload } = useAdsSession();
  const token = ads?.token ?? '';
  const pages = ads?.pages ?? [];
  const adAccounts = ads?.adAccounts ?? [];

  const [adAccount, setAdAccount] = useState<AdAccount | null>(null);
  const [selectedPageIds, setSelectedPageIds] = useState<string[]>([]);
  const [pagePicker, setPagePicker] = useState(false);
  const [adsPicker, setAdsPicker] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!ads) return;
    setAdAccount(ads.adAccounts[0] ?? null);
    setSelectedPageIds(ads.pages[0] ? [ads.pages[0].id] : []);
  }, [ads]);
  const togglePage = (id: string) => setSelectedPageIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  const currentPage = pages.find((p) => p.id === selectedPageIds[0]);

  // Video
  const [videoId, setVideoId] = useState('');
  const [cover, setCover] = useState('');
  const [videoBusy, setVideoBusy] = useState(false);
  const [linkModal, setLinkModal] = useState(false);
  const [thumbChoices, setThumbChoices] = useState<{ id: string; url: string }[]>([]);
  const [thumbLoading, setThumbLoading] = useState(false);

  const resetVideo = () => {
    setVideoId('');
    setCover('');
    setThumbChoices([]);
  };

  const loadThumbChoices = (id: string) => {
    setThumbLoading(true);
    getVideoThumbnailChoices(id, token)
      .then((list) => setThumbChoices(list))
      .catch(() => {})
      .finally(() => setThumbLoading(false));
  };

  const addVideoFromLink = async (url: string) => {
    if (!adAccount) return setError(t('swipeUp.err.noAdAccount'));
    setLinkModal(false);
    setError('');
    setVideoBusy(true);
    resetVideo();
    try {
      const { videoId: id, picture } = await uploadAdVideoFromLink({ adAccountId: adAccount.id, token, url, asyncToken: undefined, fbId });
      setVideoId(id);
      setCover(picture);
      loadThumbChoices(id);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setVideoBusy(false);
    }
  };

  const pickVideoFile = async () => {
    if (!adAccount) return setError(t('swipeUp.err.noAdAccount'));
    const [a] = await chooseMedia('video');
    if (!a) return;
    setError('');
    setVideoBusy(true);
    resetVideo();
    try {
      const { videoId: id, picture } = await uploadAdVideo(adAccount.id, token, a);
      setVideoId(id);
      setCover(picture);
      loadThumbChoices(id);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setVideoBusy(false);
    }
  };

  // Canvas: ảnh mới hoặc chọn Canvas đã publish của Page
  const [canvasImage, setCanvasImage] = useState('');
  const [canvasBusy, setCanvasBusy] = useState(false);
  const [gallery, setGallery] = useState<Canvas[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [selectedCanvasId, setSelectedCanvasId] = useState<string | null>(null);
  const [swipeLink, setSwipeLink] = useState('https://metus.vn');
  const [galleryGrid, setGalleryGrid] = useState(true);

  const loadGallery = () => {
    if (!currentPage || !token) return;
    setGalleryLoading(true);
    getPageCanvases(currentPage.id, token, { isPublished: true, limit: 50 })
      .then((r) => setGallery(r.data))
      .catch(() => {})
      .finally(() => setGalleryLoading(false));
  };

  useEffect(() => {
    setSelectedCanvasId(null);
    setGallery([]);
    loadGallery();
  }, [currentPage?.id, token]);

  const pickCanvasImage = async () => {
    if (!adAccount) return setError('');
    if (!videoId) return setError(t('swipeUp.err.noVideoYet'));
    const [a] = await chooseMedia('image');
    if (!a) return;
    setError('');
    setCanvasBusy(true);
    try {
      const { url } = await uploadCanvasImage(adAccount.id, token, a.uri, a.name, a.mimeType ?? 'image/jpeg');
      setCanvasImage(url);
      setSelectedCanvasId(null);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setCanvasBusy(false);
    }
  };

  // Nội dung
  const [headline, setHeadline] = useState('Hello Metus');
  const [primaryText, setPrimaryText] = useState('');
  const [creating, setCreating] = useState(false);
  const [posts, setPosts] = useState<PostRow[]>([]);

  const create = async () => {
    const selected = pages.filter((p) => selectedPageIds.includes(p.id));
    if (!adAccount) return setError(t('swipeUp.err.noAdAccount'));
    if (selected.length === 0) return setError(t('swipeUp.err.noPage'));
    if (!videoId) return setError(t('swipeUp.err.noVideo'));
    if (!canvasImage && !selectedCanvasId) return setError(t('swipeUp.err.noCanvasImage'));
    if (!/^https?:\/\/\S+$/i.test(swipeLink.trim())) return setError(t('swipeUp.err.badSwipeLink'));

    setError('');
    setCreating(true);
    setPosts(selected.map((p) => ({ pageId: p.id, pageName: p.name, pagePicture: p.picture, status: 'pending' })));
    try {
      const rawAdAccountId = adAccount.id.replace(/^act_/, '');
      const firstPage = selected[0];
      let canvasId: string;
      if (selectedCanvasId) {
        canvasId = selectedCanvasId;
      } else {
        const photoId = await getPhotoIdFromImageUrl(canvasImage, firstPage.id, dtsg, fbId);
        const elementId = await createCanvasElement(photoId, swipeLink.trim(), firstPage.id, rawAdAccountId, fbId, token);
        const canvasName = `Canvas_${Date.now()}`;
        canvasId = await createCanvasFromElements([elementId], canvasName, firstPage.id, fbId, token);
        await publishCanvas(canvasId, [elementId], canvasName, fbId, token);
      }

      for (const page of selected) {
        try {
          const creativeId = await createSwipeUpCreative({
            adAccountId: rawAdAccountId,
            token,
            pageId: page.id,
            videoId,
            imageUrl: cover,
            message: primaryText,
            title: headline,
            canvasId,
          });
          const storyId = await getCreativeStoryId(creativeId, token);
          await publishSwipeUpStory(storyId, page.access_token);
          setPosts((prev) => prev.map((r) => (r.pageId === page.id ? { ...r, status: 'done', note: storyId } : r)));
        } catch (e) {
          setPosts((prev) => prev.map((r) => (r.pageId === page.id ? { ...r, status: 'error', note: describeError(e) } : r)));
        }
      }
    } catch (e) {
      setError(describeError(e));
      setPosts((prev) => prev.map((r) => (r.status === 'pending' ? { ...r, status: 'error', note: describeError(e) } : r)));
    } finally {
      setCreating(false);
    }
  };

  const selectedPages = pages.filter((p) => selectedPageIds.includes(p.id));
  const pageText = selectedPages.length === 0 ? '' : selectedPages.length === 1 ? selectedPages[0].name : `${selectedPages.length} ${t('swipeUp.pages').toLowerCase()}`;
  const pageAvatar = selectedPages.length === 1 ? selectedPages[0].picture : undefined;

  return (
    <>
      <Card>
        <SelectorRow label={t('swipeUp.pages')} avatar={pageAvatar} text={pageText} placeholder={t('swipeUp.pagesPlaceholder')} onPress={() => setPagePicker(true)} />
        <SelectorRow label={t('swipeUp.adAccount')} text={adAccount ? (adAccount.account_id ?? adAccount.id) : ''} placeholder={t('swipeUp.adAccountPlaceholder')} onPress={() => setAdsPicker(true)} />
      </Card>

      {loading && !ads ? <Card><Row gap={10}><ActivityIndicator color={c.accent} /><Body muted>…</Body></Row></Card> : null}
      {adsError && !ads ? (
        <Card>
          <Body color={c.danger}>{adsError}</Body>
          <Button title="↻" variant="secondary" icon="refresh" onPress={reload} full />
        </Card>
      ) : null}

      {token ? (
        <>
          <Card>
            <Row style={{ justifyContent: 'space-between' }}>
              <Label>{t('swipeUp.videoSection')}</Label>
              <Pressable onPress={() => setLinkModal(true)} disabled={videoBusy} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.accent, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 6 }}>
                <Ionicons name="videocam" size={14} color="#fff" />
                <Body size={12} weight="700" color="#fff">{t('swipeUp.linkBtn')}</Body>
              </Pressable>
            </Row>
            <View style={{ borderRadius: radius.md, overflow: 'visible' }}>
              <View style={{ borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, overflow: 'hidden' }}>
                <Pressable onPress={pickVideoFile} disabled={videoBusy} style={{ aspectRatio: 1, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                  {cover ? (
                    <Image source={{ uri: cover }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                  ) : (
                    <>
                      <Image source={UPLOAD_BG} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                      <View style={{ position: 'absolute', left: 0, right: 0, bottom: '24%', alignItems: 'center', gap: 10, paddingHorizontal: 16 }}>
                        <GradientText size={24}>{t('swipeUp.pickFile')}</GradientText>
                        <Row gap={6} style={{ alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 }}>
                          <View style={{ width: 22, height: 22, borderRadius: 6, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
                            <Ionicons name="videocam" size={12} color="#fff" />
                          </View>
                          <Body size={12} weight="700" color="#1d3f72">{t('swipeUp.pickFileHint')}</Body>
                        </Row>
                      </View>
                    </>
                  )}
                  {videoBusy ? (
                    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      <ActivityIndicator color="#fff" size="large" />
                      <Body size={12} weight="700" color="#fff">{t('swipeUp.uploading')}</Body>
                    </View>
                  ) : null}
                </Pressable>
              </View>
              {videoId && (thumbLoading || thumbChoices.length > 1) ? (
                <View style={{ backgroundColor: c.card, paddingHorizontal: 8, paddingVertical: 8 }}>
                  {thumbLoading ? (
                    <Row gap={10}><ActivityIndicator color={c.accent} size="small" /><Body muted size={12}>…</Body></Row>
                  ) : (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                      {thumbChoices.map((th) => {
                        const active = cover === th.url;
                        return (
                          <Pressable key={th.id} onPress={() => setCover(th.url)}
                            style={{ width: 56, height: 56, borderRadius: radius.sm, overflow: 'hidden', borderWidth: active ? 3 : 1, borderColor: active ? c.accent : c.border }}>
                            <Image source={{ uri: th.url }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  )}
                </View>
              ) : null}
              <View style={{ position: 'relative' }}>
                <Row style={{ backgroundColor: c.card, borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md, padding: 12 }}>
                  <Body weight="700" size={14} numberOfLines={1}>{headline || t('swipeUp.headline')}</Body>
                </Row>
                <SwipeChevron c={c} />
              </View>
            </View>
          </Card>

          <Card>
            <Label>{t('swipeUp.canvasSection')}</Label>
            <View style={[{ borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: c.border, backgroundColor: c.card, opacity: videoId ? 1 : 0.5 }, shadow(c, 1)]}>
              <Pressable onPress={pickCanvasImage} disabled={canvasBusy || !videoId} style={{ aspectRatio: 1, alignItems: 'center', justifyContent: 'center' }}>
                {canvasImage ? (
                  <Image source={{ uri: canvasImage }} style={{ width: '100%', height: '100%', position: 'absolute' }} resizeMode="cover" />
                ) : (
                  <>
                    <Image source={UPLOAD_BG} style={{ width: '100%', height: '100%', position: 'absolute' }} resizeMode="cover" />
                    <View style={{ position: 'absolute', left: 0, right: 0, bottom: '24%', alignItems: 'center', gap: 10, paddingHorizontal: 16 }}>
                      <GradientText size={24}>{t('swipeUp.pickImage')}</GradientText>
                      <Row gap={6} style={{ alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 }}>
                        <View style={{ width: 22, height: 22, borderRadius: 6, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
                          <Ionicons name="image" size={12} color="#fff" />
                        </View>
                        <Body size={12} weight="700" color="#1d3f72">{t('swipeUp.pickImageHint')}</Body>
                      </Row>
                    </View>
                  </>
                )}
                {!videoId ? (
                  <View style={{ position: 'absolute', bottom: 10 }}>
                    <Body muted size={11}>{t('swipeUp.err.noVideoYet')}</Body>
                  </View>
                ) : null}
                {canvasBusy ? (
                  <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' }}>
                    <ActivityIndicator color="#fff" />
                  </View>
                ) : null}
              </Pressable>
              <View style={{ alignItems: 'center', paddingVertical: 14, gap: 6 }}>
                <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="chevron-up" size={16} color="#fff" />
                </View>
                <Body muted size={11}>{t('swipeUp.swipeFooter')}</Body>
              </View>
            </View>
            <Row gap={6} style={{ alignItems: 'center' }}>
              <Body muted size={12}>{t('swipeUp.useExisting')}</Body>
              {selectedCanvasId ? <Badge text={getCanvasName(gallery.find((g) => g.id === selectedCanvasId)!)} tone="accent" /> : <Body muted size={11}>{t('swipeUp.pickFromGallery')}</Body>}
            </Row>
            <Field label={t('swipeUp.swipeLink')} value={swipeLink} onChangeText={setSwipeLink} placeholder={t('swipeUp.swipeLinkPh')} autoCapitalize="none" keyboardType="url" />
          </Card>

          <Card>
            <Row style={{ justifyContent: 'space-between' }}>
              <Row gap={6}>
                <Pressable onPress={() => setGalleryGrid(true)} style={{ padding: 8, borderRadius: radius.sm, backgroundColor: galleryGrid ? c.text : 'transparent' }}>
                  <Ionicons name="grid" size={16} color={galleryGrid ? c.card : c.faint} />
                </Pressable>
                <Pressable onPress={() => setGalleryGrid(false)} style={{ padding: 8, borderRadius: radius.sm, backgroundColor: !galleryGrid ? c.text : 'transparent' }}>
                  <Ionicons name="reorder-four" size={16} color={!galleryGrid ? c.card : c.faint} />
                </Pressable>
                <Pressable onPress={loadGallery} disabled={galleryLoading} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#a855f7', borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 7 }}>
                  <Ionicons name="albums" size={14} color="#fff" />
                  <Body size={12} weight="700" color="#fff">{t('swipeUp.canvasGallery')}</Body>
                </Pressable>
              </Row>
              <Body muted size={12}>{t('swipeUp.canvasCount', { n: gallery.length })}</Body>
            </Row>
            {galleryLoading ? (
              <Row gap={10}><ActivityIndicator color={c.accent} /><Body muted size={12}>…</Body></Row>
            ) : gallery.length === 0 ? (
              <Body muted size={12}>{t('swipeUp.noCanvases')}</Body>
            ) : galleryGrid ? (
              <Row style={{ flexWrap: 'wrap' }} gap={8}>
                {gallery.map((cv) => {
                  const active = selectedCanvasId === cv.id;
                  const thumb = getCanvasThumbnail(cv);
                  return (
                    <Pressable key={cv.id} onPress={() => { setSelectedCanvasId(active ? null : cv.id); setCanvasImage(''); }}
                      style={{ width: '31%', aspectRatio: 1, borderRadius: radius.sm, overflow: 'hidden', borderWidth: active ? 3 : 1, borderColor: active ? c.accent : c.border }}>
                      {thumb ? <Image source={{ uri: thumb }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : <View style={{ flex: 1, backgroundColor: c.chip, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="apps" size={18} color={c.faint} /></View>}
                    </Pressable>
                  );
                })}
              </Row>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {gallery.map((cv) => {
                  const active = selectedCanvasId === cv.id;
                  const thumb = getCanvasThumbnail(cv);
                  return (
                    <Pressable key={cv.id} onPress={() => { setSelectedCanvasId(active ? null : cv.id); setCanvasImage(''); }}
                      style={{ width: 90, height: 90, borderRadius: radius.sm, overflow: 'hidden', borderWidth: active ? 3 : 1, borderColor: active ? c.accent : c.border }}>
                      {thumb ? <Image source={{ uri: thumb }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : <View style={{ flex: 1, backgroundColor: c.chip, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="apps" size={18} color={c.faint} /></View>}
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
          </Card>

          <Card>
            <Label>{t('swipeUp.contentSection')}</Label>
            <Field label={t('swipeUp.headline')} value={headline} onChangeText={setHeadline} placeholder={t('swipeUp.headlinePh')} />
            <Field label={t('swipeUp.message')} value={primaryText} onChangeText={setPrimaryText} multiline placeholder={t('swipeUp.messagePh')} />
          </Card>

          {error ? <Body color={c.danger} size={13}>{error}</Body> : null}
          <Button title={creating ? t('swipeUp.creating') : t('swipeUp.submit')} icon="send" onPress={create} loading={creating} full />
        </>
      ) : null}

      {posts.length ? (
        <Card>
          <Label>{t('swipeUp.posts', { n: posts.length })}</Label>
          <ResultList
            items={posts}
            keyOf={(p) => p.pageId}
            render={(p) => (
              <Pressable onPress={() => { if (p.status === 'done' && p.note) Linking.openURL(`https://facebook.com/${p.note}`); }}>
                <Row gap={10}>
                  {p.pagePicture ? <Image source={{ uri: p.pagePicture }} style={{ width: 28, height: 28, borderRadius: 14 }} /> : <Ionicons name="flag" size={18} color={c.faint} />}
                  <View style={{ flex: 1 }}>
                    <Body weight="600" size={14} numberOfLines={1}>{p.pageName}</Body>
                    {p.status === 'error' && p.note ? <Body muted size={11} numberOfLines={1}>{p.note}</Body> : null}
                  </View>
                  {p.status === 'pending' ? <ActivityIndicator color={c.accent} size="small" /> : null}
                  <Badge text={t(`swipeUp.st.${p.status}`)} tone={p.status === 'done' ? 'success' : p.status === 'error' ? 'danger' : 'muted'} />
                </Row>
              </Pressable>
            )}
          />
        </Card>
      ) : null}

      <PickerModal visible={pagePicker} title={t('swipeUp.pagesPlaceholder')} onClose={() => setPagePicker(false)} items={pages} multi
        keyOf={(p) => p.id} labelOf={(p) => p.name} avatarOf={(p) => p.picture} selectedKeys={selectedPageIds}
        onToggle={(p) => togglePage(p.id)} />
      <PickerModal visible={adsPicker} title={t('swipeUp.adAccountPlaceholder')} onClose={() => setAdsPicker(false)} items={adAccounts}
        keyOf={(a) => a.id} labelOf={(a) => `${a.name} (${a.account_id ?? a.id})`} selectedKeys={adAccount ? [adAccount.id] : []}
        onToggle={(a) => setAdAccount(a)} />
      <LinkVideoModal visible={linkModal} onClose={() => setLinkModal(false)} onSubmit={addVideoFromLink} />
    </>
  );
}

export default function SwipeUpVideoScreen() {
  return (
    <Screen>
      <ToolGate require="package">{(dtsg, fbId) => <Runner dtsg={dtsg} fbId={fbId} />}</ToolGate>
    </Screen>
  );
}
