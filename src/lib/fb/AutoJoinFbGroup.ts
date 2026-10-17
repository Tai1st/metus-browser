// Port nguyên văn từ metus-few/src/services/facebook/AutoJoinFbGroup.ts (chỉ đổi import).
import type { JoinGroupResponse } from './types';
import { instance } from './compat';

const parseFacebookText = (raw: string) => {
  const cleaned = raw.startsWith('for (;;);') ? raw.slice(9) : raw;
  return JSON.parse(cleaned);
};

export type FetchGroupInfoParams = {
  dtsg: string;
  fbId: string;
  groupId: string;
};

export const fetchGroupInfo = async ({
  dtsg,
  fbId,
  groupId,
}: FetchGroupInfoParams): Promise<any> => {
  const formData = new FormData();
  formData.append('fb_dtsg', dtsg || '');
  formData.append('__user', fbId);
  formData.append('__a', '1');
  formData.append('doc_id', '6330609380392645');
  formData.append(
    'variables',
    JSON.stringify({
      actionBarRenderLocation: 'WWW_COMET_HOVERCARD',
      context: 'GROUP',
      entityID: groupId,
      groupID: groupId,
      includeTdaInfo: false,
      scale: 1,
    })
  );

  const response = await instance.post(
    `https://www.facebook.com/api/graphql/?metuscors=0`,
    formData,
    {
      headers: {
        accept: 'application/json, text/plain, */*',
        origin: 'https://www.facebook.com',
        referer: 'https://www.facebook.com',
      },
      responseType: 'text',
    }
  );

  const raw = response.data as string;
  return parseFacebookText(raw);
};

export type JoinGroupParams = {
  dtsg: string;
  fbId: string;
  groupId: string;
};

export const joinGroupRequest = async ({
  dtsg,
  fbId,
  groupId,
}: JoinGroupParams): Promise<JoinGroupResponse> => {
  const formData = new FormData();
  formData.append('fb_dtsg', dtsg || '');
  formData.append('__user', fbId);
  formData.append('__a', '1');
  formData.append('doc_id', '6022707887851452');
  formData.append(
    'variables',
    JSON.stringify({
      feedType: 'DISCUSSION',
      groupID: groupId,
      imageMediaType: 'image/x-auto',
      input: {
        action_source: 'GROUPS_DISCOVER_TAB',
        attribution_id_v2:
          'GroupsCometDiscoverRoot.react,comet.groups.discover,via_cold_start,1685515419972,249396,,',
        group_id: groupId,
        group_share_tracking_params: null,
        actor_id: fbId,
        client_mutation_id: '1',
      },
      inviteShortLinkKey: null,
      isChainingRecommendationUnit: false,
      isEntityMenu: false,
      scale: 1,
      source: 'GROUPS_DISCOVER_TAB',
      renderLocation: 'group_mall',
      __relay_internal__pv__GlobalPanelEnabledrelayprovider: false,
      __relay_internal__pv__GroupsCometEntityMenuChannelsrelayprovider: true,
      __relay_internal__pv__GroupsCometEntityMenuUseChatThumbnailsrelayprovider:
        true,
      __relay_internal__pv__GroupsCometHasLeftRailNavImprovementrelayprovider:
        true,
      __relay_internal__pv__GroupsCometGroupChatLazyLoadLastMessageSnippetrelayprovider:
        false,
      __relay_internal__pv__GroupsCometDelayCheckBlockedUsersrelayprovider:
        false,
    })
  );

  const { data } = await instance.post(
    `https://www.facebook.com/api/graphql/?metuscors=0`,
    formData,
    {
      headers: {
        accept: 'application/json, text/plain, */*',
        origin: 'https://www.facebook.com',
        referer: 'https://www.facebook.com',
      },
    }
  );

  if (typeof data === 'string' && data.startsWith('for (;;);')) {
    return JSON.parse(data.slice(9));
  }

  return data as JoinGroupResponse;
};
