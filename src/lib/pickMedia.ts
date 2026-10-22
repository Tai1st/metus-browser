/**
 * Chọn ảnh/video: hỏi nguồn "Thư viện ảnh" (expo-image-picker) hoặc "Tệp trên máy"
 * (expo-document-picker) rồi trả về cùng một kiểu dữ liệu cho mọi tool.
 */
import * as DocumentPicker from 'expo-document-picker';
import * as FS from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';

import { showDialog } from '@/components/Dialog';

import { tr } from './i18n';

export type MediaKind = 'image' | 'video' | 'mixed';

export interface PickedMedia {
  uri: string;
  name: string;
  mimeType?: string;
  size?: number;
  isVideo: boolean;
}

type Source = 'library' | 'files';

/** Hỏi nguồn chọn file; null nếu người dùng hủy. */
function askSource(): Promise<Source | null> {
  return new Promise((resolve) => {
    showDialog(tr('media.pickTitle'), undefined, [
      { text: tr('common.cancel'), style: 'cancel', onPress: () => resolve(null) },
      { text: tr('media.fromLibrary'), onPress: () => resolve('library') },
      { text: tr('media.fromFiles'), onPress: () => resolve('files') },
    ]);
  });
}

const extOf = (mime?: string, isVideo?: boolean) =>
  mime?.split('/')[1]?.replace('quicktime', 'mov').replace('jpeg', 'jpg') ?? (isVideo ? 'mp4' : 'jpg');

async function fromLibrary(kind: MediaKind, multiple: boolean): Promise<PickedMedia[]> {
  const r = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: kind === 'image' ? ['images'] : kind === 'video' ? ['videos'] : ['images', 'videos'],
    allowsMultipleSelection: multiple,
    selectionLimit: multiple ? 0 : 1,
    quality: 1,
    // Giữ nguyên file gốc (không nén lại video)
    videoExportPreset: ImagePicker.VideoExportPreset.Passthrough,
  });
  if (r.canceled) return [];
  return r.assets.map((a, i) => {
    const isVideo = a.type === 'video' || (a.mimeType ?? '').startsWith('video/');
    const mimeType = a.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg');
    return {
      uri: a.uri,
      name: a.fileName ?? `${isVideo ? 'video' : 'image'}_${Date.now()}_${i}.${extOf(mimeType, isVideo)}`,
      mimeType,
      size: a.fileSize,
      isVideo,
    };
  });
}

async function fromFiles(kind: MediaKind, multiple: boolean): Promise<PickedMedia[]> {
  const r = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple,
    type: kind === 'image' ? 'image/*' : kind === 'video' ? 'video/*' : ['image/*', 'video/*'],
  });
  if (r.canceled) return [];
  return r.assets.map((a) => ({
    uri: a.uri,
    name: a.name,
    mimeType: a.mimeType ?? undefined,
    size: a.size,
    isVideo: (a.mimeType ?? '').startsWith('video/'),
  }));
}

/** Chọn ảnh/video: hỏi nguồn rồi mở trình chọn tương ứng. Trả về [] nếu hủy. */
export async function pickMedia(kind: MediaKind, multiple = false): Promise<PickedMedia[]> {
  const src = await askSource();
  if (!src) return [];
  try {
    const picked = src === 'library' ? await fromLibrary(kind, multiple) : await fromFiles(kind, multiple);
    // Một số máy không trả dung lượng → đọc từ file (upload video cần biết size)
    return Promise.all(
      picked.map(async (m) => {
        if (m.size) return m;
        const info = await FS.getInfoAsync(m.uri).catch(() => null);
        return info?.exists ? { ...m, size: info.size } : m;
      }),
    );
  } catch (e) {
    showDialog(tr('media.pickErr'), e instanceof Error ? e.message : String(e));
    return [];
  }
}
