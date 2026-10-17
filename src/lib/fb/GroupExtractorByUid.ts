// Port nguyên văn từ metus-few/src/services/facebook/GroupExtractorByUid.ts (chỉ đổi import).
import qs from 'qs';
import { instance } from './compat';

export type FetchCollectionTokenParams = {
  dtsg: string;
  fbId: string;
  uid: string;
};

export const fetchCollectionToken = async ({
  dtsg,
  fbId,
  uid,
}: FetchCollectionTokenParams): Promise<string | null> => {
  const data = qs.stringify({
    dpr: '1',
    __a: '1',
    __aaid: '0',
    __ccg: 'GOOD',
    __comet_req: '15',
    server_timestamps: 'true',
    fb_dtsg: dtsg,
    client_previous_actor_id: uid,
    route_url: `/${uid}/groups_member`,
    routing_namespace: 'fb_comet',
  });

  const { data: raw } = await instance.post<string>(
    `https://www.facebook.com/ajax/route-definition/`,
    data,
    {
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://www.facebook.com',
        referer: 'https://www.facebook.com',
      },
      responseType: 'text',
      transformResponse: (r) => r,
    }
  );
  const parts = raw.split('for (;;);').filter(Boolean);

  for (const part of parts) {
    try {
      const json = JSON.parse(part);
      const token =
        json?.payload?.result?.exports?.rootView?.props?.collectionToken;
      if (token) return token;
    } catch (err) {
      console.error('Parse JSON lỗi:', err);
    }
  }

  return null;
};

export type FetchGroupsPageParams = {
  dtsg: string;
  fbId: string;
  collectionToken: string;
  cursor: string;
};

export const fetchGroupsPage = async ({
  dtsg,
  fbId,
  collectionToken,
  cursor,
}: FetchGroupsPageParams) => {
  const variables = {
    count: 8,
    cursor,
    id: collectionToken,
  };

  const data = qs.stringify({
    dpr: '1',
    __a: '1',
    __aaid: '0',
    __ccg: 'GOOD',
    __comet_req: '15',
    server_timestamps: 'true',
    fb_dtsg: dtsg,
    fb_api_req_friendly_name:
      'ProfileCometAppCollectionGridRendererPaginationQuery',
    variables: JSON.stringify(variables),
    doc_id: '5244211935648733',
  });

  const { data: raw } = await instance.post<string>(
    `https://www.facebook.com/api/graphql/`,
    data,
    {
      headers: {
        accept: '*/*',
        'accept-language': 'vi,en-GB;q=0.9,en;q=0.8',
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://www.facebook.com',
        referer: 'https://www.facebook.com',
      },
      responseType: 'text',
      transformResponse: (r) => r,
    }
  );

  const firstLine = raw.split('\n')[0];
  return JSON.parse(firstLine);
};
