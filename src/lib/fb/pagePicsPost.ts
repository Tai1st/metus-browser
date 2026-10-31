/**
 * Đăng ảnh thường lên Page hàng loạt — port từ metus-few
 * src/services/facebook/UpToPics.ts (upload ảnh + đăng bài ảnh lên Page).
 */
import { instance } from './compat';
import { parseFbJson, type LocalFile } from './Group';

const genId = (len: number) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let r = '';
  for (let i = 0; i < len; i++) r += chars.charAt(Math.floor(Math.random() * chars.length));
  return r;
};

export interface UploadedPagePhoto {
  photoId: string;
  imageUrl: string;
}

/** Upload 1 ảnh lên Page, trả photoID + URL ảnh thật (uploadPhoto của metus-few). */
export async function uploadPagePhoto(dtsg: string, fbId: string, pageId: string, file: LocalFile): Promise<UploadedPagePhoto> {
  const form = new FormData();
  form.append('source', '8');
  form.append('profile_id', fbId);
  form.append('waterfallxapp', 'comet');
  form.append('farr', { uri: file.uri, name: file.name, type: file.type ?? 'image/jpeg' } as unknown as Blob);
  form.append('upload_id', genId(10));
  form.append('fb_dtsg', dtsg);

  const { data } = await instance.post<string>(
    `https://upload-business.facebook.com/ajax/react_composer/attachments/photo/upload?av=${pageId}&__user=${fbId}&__a=1&fb_dtsg=${dtsg}&metuscors=0`,
    form,
    { iUser: pageId, responseType: 'text', transformResponse: (r) => r },
  );
  const json = parseFbJson(data);
  const photoId = json?.payload?.photoID;
  const imageUrl = json?.payload?.imageSrc;
  if (!photoId || !imageUrl) throw new Error('Upload ảnh thất bại: không lấy được photoID');
  return { photoId, imageUrl };
}

/** 1 ảnh đính kèm trong bài — `caption` riêng rỗng thì dùng `message` chung của bài (giống metus-few: `photo.caption || content`). */
export interface PhotoAttachmentInput {
  photoId: string;
  imageUrl: string;
  caption?: string;
}

export interface PublishPagePhotoParams {
  dtsg: string;
  fbId: string;
  pageId: string;
  attachments: PhotoAttachmentInput[];
  /** Nội dung chung của bài (facebookNewsFeed.message). */
  message: string;
  isDraft?: boolean;
  scheduledUnix?: number;
  reshareToStory?: boolean;
  textFormatPresetId?: string;
}

/** Đăng bài ảnh (1 hoặc nhiều ảnh) lên Page (publishPost của metus-few) — trả post_id nếu đăng ngay/hẹn giờ. */
export async function publishPagePhotoPost(p: PublishPagePhotoParams): Promise<string | undefined> {
  const unpublishedContentData = p.isDraft
    ? { unpublished_content_type: 'DRAFT' }
    : p.scheduledUnix
      ? { scheduled_publish_time: p.scheduledUnix, unpublished_content_type: 'SCHEDULED' }
      : null;

  const photoAttachments = p.attachments.map((a) => ({
    photo: {
      id: a.photoId,
      message: { text: a.caption || p.message || '' },
      custom_accessibility_caption: a.caption || p.message || '',
      photo_link_metadata: { link: { external: { url: a.imageUrl } } },
    },
  }));

  const facebookNewsFeed: Record<string, unknown> = {
    message: { ranges: [], text: p.message || '' },
    specified_dialect: 'vi_VN',
    multilingual_translations: [],
    attachments: photoAttachments,
  };
  if (p.textFormatPresetId) facebookNewsFeed.text_format_preset_id = p.textFormatPresetId;

  const base: Record<string, unknown> = {
    actor_id: p.pageId,
    composer_entry_point: 'biz_web_content_manager_published_posts',
    message: { ranges: [], text: p.message || '' },
    attachments: photoAttachments,
    source: 'WWW',
    unpublished_content_data: unpublishedContentData,
    explicit_place_id: '',
    audiences: [{ business_presence: { business_presence_id: p.pageId } }],
    is_autosave_draft: false,
    is_review_requested: false,
    request_review_data: { review_request_status: null },
    post_collaborators: { post_collaborators: [] },
    comment_attached_posting: null,
    boost_status: { is_boost_toggle_on: null, is_boost_afterparty_eligible: null },
  };
  if (p.reshareToStory) base.post_publish_story_data = { resharing_frequency: null, reshare_post_as_sticker: 'ENABLED' };

  const variables = {
    input: {
      client_mutation_id: `${genId(10)}-${Date.now()}`,
      base,
      channels: ['FACEBOOK_NEWS_FEED'],
      FACEBOOK_NEWS_FEED: facebookNewsFeed,
      FACEBOOK_GROUP: null,
      INSTAGRAM_POST: null,
      identities: [p.pageId],
      ad_campaign_group: null,
      raw_boosted_component_spec: 'null',
      logging: { composer_session_id: genId(16) },
    },
    checkPhotosToReelsUpsellEligibility: false,
  };

  const form = new FormData();
  form.append('av', p.pageId);
  form.append('__user', p.fbId);
  form.append('__a', '1');
  form.append('__comet_req', '0');
  form.append('fb_dtsg', p.dtsg);
  form.append('__rev', '1038169738');
  form.append('jazoest', '250707351');
  form.append('__spin_r', '1038169738');
  form.append('__spin_b', 'trunk');
  form.append('__spin_t', String(Math.floor(Date.now() / 1000)));
  form.append('fb_api_caller_class', 'RelayModern');
  form.append('fb_api_req_friendly_name', 'BusinessComposerStoryCreationMutation');
  form.append('variables', JSON.stringify(variables));
  form.append('server_timestamps', 'true');
  form.append('doc_id', '7824581757552022');

  const { data } = await instance.post<string>('https://business.facebook.com/api/graphql?metus_latest', form, {
    iUser: p.pageId,
    responseType: 'text',
    transformResponse: (r) => r,
  });
  const json = parseFbJson(data);
  if (json?.errors?.length && !json?.data) throw new Error(json.errors[0]?.message ?? 'Đăng bài thất bại');
  return json?.data?.xfamily_content_create?.items?.[0]?.story?.post_id;
}
