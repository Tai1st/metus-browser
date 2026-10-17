// Chỉ giữ phần metus-few thực sự đọc từ response (bản gốc types/JoinGroupResponse.ts ~1800 dòng).
export interface JoinGroupResponse {
  data?: {
    group_request_to_join?: {
      viewer?: {
        groups_tab?: {
          tab_groups_list?: { edges?: { node?: { id?: string } }[] };
        };
      };
    };
  };
  errors?: { message?: string }[];
}

export interface FbAccount {
  id: string;
  name: string;
  picture: string;
}
