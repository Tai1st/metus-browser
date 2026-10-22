import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, Text, View } from 'react-native';

import { PickerModal, SelectorRow } from '@/components/AdPostTool';
import { ResultList, ToolGate } from '@/components/tool';
import { Badge, Body, Button, Card, Field, Label, Row, Screen, radius, useColors } from '@/components/ui';
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
  publishCanvas,
  publishSwipeUpStory,
  uploadCanvasImage,
} from '@/lib/fb/swipeUpVideo';
import { uploadAdVideo } from '@/lib/fb/videoCarousel';
import { detectVideoLink, uploadAdVideoFromLink } from '@/lib/fb/videoFromLink';
import { useT } from '@/lib/i18n';
import { pickMedia as chooseMedia } from '@/lib/pickMedia';

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
  const [videoUrl, setVideoUrl] = useState('');
  const [videoId, setVideoId] = useState('');
  const [cover, setCover] = useState('');
  const [videoBusy, setVideoBusy] = useState(false);

  const resetVideo = () => {
    setVideoId('');
    setCover('');
  };

  const addVideoFromLink = async () => {
    const url = videoUrl.trim();
    if (!detectVideoLink(url)) return setError(t('swipeUp.err.badLink'));
    if (!adAccount) return setError(t('swipeUp.err.noAdAccount'));
    setError('');
    setVideoBusy(true);
    resetVideo();
    try {
      const { videoId: id, picture } = await uploadAdVideoFromLink({ adAccountId: adAccount.id, token, url, asyncToken: undefined, fbId });
      setVideoId(id);
      setCover(picture);
      setVideoUrl('');
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

  useEffect(() => {
    setSelectedCanvasId(null);
    setGallery([]);
    if (!currentPage || !token) return;
    setGalleryLoading(true);
    getPageCanvases(currentPage.id, token, { isPublished: true, limit: 50 })
      .then((r) => setGallery(r.data))
      .catch(() => {})
      .finally(() => setGalleryLoading(false));
  }, [currentPage?.id, token]);

  const pickCanvasImage = async () => {
    if (!adAccount) return setError('');
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
            <Label>{t('swipeUp.videoSection')}</Label>
            <Pressable onPress={pickVideoFile} disabled={videoBusy} style={{ aspectRatio: 16 / 9, borderRadius: radius.md, overflow: 'hidden', backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
              {cover ? (
                <Image source={{ uri: cover }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
              ) : (
                <View style={{ alignItems: 'center', gap: 8 }}>
                  <Ionicons name="videocam-outline" size={40} color={c.accent} />
                  <Body weight="700" size={14} color={c.accent}>{t('swipeUp.pickFile')}</Body>
                </View>
              )}
              {videoBusy ? (
                <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <ActivityIndicator color="#fff" />
                  <Body size={12} color="#fff">{t('swipeUp.uploading')}</Body>
                </View>
              ) : null}
            </Pressable>
            <Field value={videoUrl} onChangeText={setVideoUrl} editable={!videoBusy} autoCapitalize="none" keyboardType="url" placeholder={t('swipeUp.linkPh')}
              icon="link-outline" rightIcon="cloud-download-outline" onRightIconPress={addVideoFromLink} />
          </Card>

          <Card>
            <Label>{t('swipeUp.canvasSection')}</Label>
            <Row gap={10}>
              <Pressable onPress={pickCanvasImage} disabled={canvasBusy} style={{ flex: 1, aspectRatio: 1, borderRadius: radius.md, overflow: 'hidden', backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                {canvasImage ? (
                  <Image source={{ uri: canvasImage }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                ) : (
                  <View style={{ alignItems: 'center', gap: 6 }}>
                    <Ionicons name="image-outline" size={30} color={c.accent} />
                    <Body weight="700" size={12} color={c.accent}>{t('swipeUp.uploadNew')}</Body>
                  </View>
                )}
                {canvasBusy ? (
                  <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' }}>
                    <ActivityIndicator color="#fff" />
                  </View>
                ) : null}
              </Pressable>
              <View style={{ flex: 2, gap: 6 }}>
                <Body muted size={12}>{t('swipeUp.useExisting')}</Body>
                {galleryLoading ? (
                  <ActivityIndicator color={c.accent} />
                ) : gallery.length === 0 ? (
                  <Body muted size={12}>{t('swipeUp.noCanvases')}</Body>
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {gallery.map((cv) => {
                      const active = selectedCanvasId === cv.id;
                      const thumb = getCanvasThumbnail(cv);
                      return (
                        <Pressable key={cv.id} onPress={() => { setSelectedCanvasId(active ? null : cv.id); setCanvasImage(''); }}
                          style={{ width: 64, height: 64, borderRadius: radius.sm, overflow: 'hidden', borderWidth: active ? 3 : 1, borderColor: active ? c.accent : c.border }}>
                          {thumb ? <Image source={{ uri: thumb }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : <View style={{ flex: 1, backgroundColor: c.chip, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="apps" size={18} color={c.faint} /></View>}
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                )}
                {selectedCanvasId ? <Badge text={getCanvasName(gallery.find((g) => g.id === selectedCanvasId)!)} tone="accent" /> : null}
              </View>
            </Row>
            <Field label={t('swipeUp.swipeLink')} value={swipeLink} onChangeText={setSwipeLink} placeholder={t('swipeUp.swipeLinkPh')} autoCapitalize="none" keyboardType="url" />
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
