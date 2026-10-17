import { fileBody, MetusHttpError, type MetusHttpResponse } from '@metus/http';
import { Metus } from '@metus/http';
import * as DocumentPicker from 'expo-document-picker';
import { useRef, useState } from 'react';
import { Pressable, Switch, View } from 'react-native';

import { Badge, Body, Button, Card, ErrorText, Field, Label, Row, Screen, Segmented, useColors } from '@/components/ui';

const METHOD_COLOR: Record<string, string> = {
  GET: '#10b981', POST: '#f97316', PUT: '#3b82f6', PATCH: '#8b5cf6', DELETE: '#ef4444', HEAD: '#64748b', OPTIONS: '#64748b',
};
import {
  AUTH_MODES,
  BODY_MODES,
  buildRequest,
  emptyDraft,
  METHODS,
  prettyBody,
  toHistory,
  type ApiClientDraft,
  type HistoryItem,
  type PickedFile,
} from '@/lib/apiClient';
import { useT } from '@/lib/i18n';
import { useFbAccounts } from '@/lib/fb/accounts';
import * as storage from '@/lib/storage';

const MAX_PREVIEW = 200_000;

export default function ApiClientScreen() {
  const c = useColors();
  const tr = useT();
  const { current } = useFbAccounts();
  const [d, setD] = useState<ApiClientDraft>(emptyDraft);
  const [file, setFile] = useState<PickedFile | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [res, setRes] = useState<MetusHttpResponse<string | ArrayBuffer> | null>(null);
  const [tab, setTab] = useState<'Body' | 'Headers'>('Body');
  const [history, setHistory] = useState<HistoryItem[]>(
    () => storage.get<HistoryItem[]>(storage.StorageKey.API_CLIENT_HISTORY) ?? [],
  );
  const abortRef = useRef<AbortController | null>(null);

  const up = <K extends keyof ApiClientDraft>(k: K, v: ApiClientDraft[K]) => setD((p) => ({ ...p, [k]: v }));

  const pushHistory = (item: HistoryItem) => {
    const next = [item, ...history].slice(0, 30);
    setHistory(next);
    storage.set(storage.StorageKey.API_CLIENT_HISTORY, next);
  };

  const pickFile = async () => {
    const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    if (!r.canceled && r.assets[0]) {
      const a = r.assets[0];
      setFile({ uri: a.uri, name: a.name, mimeType: a.mimeType ?? undefined, size: a.size ?? undefined });
    }
  };

  const send = async () => {
    if (sending) return;
    setError('');
    setRes(null);
    let built;
    try {
      built = buildRequest(d, file, (f) => fileBody(f.uri, { type: f.mimeType }));
    } catch (e) {
      setError(tr('api.dataErr', { err: e instanceof Error ? e.message : String(e) }));
      return;
    }
    if (d.useAccount && !current) {
      setError(tr('api.needAccount'));
      return;
    }
    setSending(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const response = await Metus.http.request<string | ArrayBuffer>({
        url: d.url.trim(),
        method: d.method,
        headers: built.headers,
        params: built.params,
        body: built.body,
        responseType: d.method === 'HEAD' ? 'text' : 'auto',
        credentials: d.useAccount ? 'include' : 'omit',
        account: d.useAccount ? current?.id : undefined,
        signal: ctrl.signal,
        timeout: 120_000,
      });
      setRes(response);
      pushHistory(toHistory(d, response.status, response.durationMs));
    } catch (e) {
      const msg = e instanceof MetusHttpError ? `${e.message} [${e.code}]` : e instanceof Error ? e.message : String(e);
      setError(msg);
      pushHistory(toHistory(d));
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  };

  const statusTone = res && res.status >= 200 && res.status < 300 ? 'success' : res && res.status >= 400 ? 'danger' : 'muted';

  return (
    <Screen>
      <Card>
        <Label>Request</Label>
        <Segmented value={d.method} options={METHODS} onChange={(m) => up('method', m)} colorFor={(m) => METHOD_COLOR[m]} />
        <Field label="URL" value={d.url} onChangeText={(t) => up('url', t)} keyboardType="url" placeholder="https://graph.facebook.com/me" />
        <Field label={tr('api.queryParams')} value={d.params} onChangeText={(t) => up('params', t)} multiline />
        <Field label={tr('api.headers')} value={d.headers} onChangeText={(t) => up('headers', t)} multiline />
      </Card>

      <Card>
        <Label>Body</Label>
        <Segmented value={d.bodyMode} options={BODY_MODES} onChange={(m) => up('bodyMode', m)} />
        {d.bodyMode === 'json' || d.bodyMode === 'text' ? (
          <Field value={d.body} onChangeText={(t) => up('body', t)} multiline placeholder={d.bodyMode === 'json' ? '{ "message": "Hello Metus" }' : tr('api.bodyPlaceholder')} />
        ) : null}
        {d.bodyMode === 'form' || d.bodyMode === 'multipart' ? (
          <Field
            value={d.body}
            onChangeText={(t) => up('body', t)}
            multiline
            placeholder={d.bodyMode === 'multipart' ? tr('api.multipartPlaceholder') : 'key=value'}
          />
        ) : null}
        {d.bodyMode === 'file' || d.bodyMode === 'multipart' ? (
          <Row>
            <View style={{ flex: 1 }}>
              <Button compact variant="secondary" title={file ? `📎 ${file.name}` : tr('api.pickFile')} onPress={pickFile} />
            </View>
            {file ? <Button compact variant="secondary" title={tr('api.removeFile')} onPress={() => setFile(null)} /> : null}
          </Row>
        ) : null}
      </Card>

      <Card>
        <Label>{tr('api.auth')}</Label>
        <Segmented value={d.authMode} options={AUTH_MODES} onChange={(m) => up('authMode', m)} />
        {d.authMode === 'bearer' ? <Field label="Token" value={d.token} onChangeText={(t) => up('token', t)} /> : null}
        {d.authMode === 'basic' ? (
          <>
            <Field label="Username" value={d.username} onChangeText={(t) => up('username', t)} />
            <Field label="Password" value={d.password} onChangeText={(t) => up('password', t)} secureTextEntry />
          </>
        ) : null}
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Body>{tr('api.sendCookie')}</Body>
            <Body muted>{current ? `${current.name} (${current.id})` : tr('api.noAccount')}</Body>
          </View>
          <Switch value={d.useAccount} onValueChange={(v) => up('useAccount', v)} />
        </Row>
      </Card>

      <Row>
        <View style={{ flex: 1 }}>
          <Button title={tr('api.send')} onPress={send} loading={sending} />
        </View>
        {sending ? <Button compact variant="secondary" title={tr('common.cancel')} onPress={() => abortRef.current?.abort()} /> : null}
      </Row>

      <ErrorText>{error}</ErrorText>

      {res ? (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Badge text={`${res.status} ${res.statusText}`} tone={statusTone} />
            <Body muted>{res.durationMs} ms</Body>
          </Row>
          <Segmented value={tab} options={['Body', 'Headers'] as const} onChange={setTab} />
          {tab === 'Headers' ? (
            <Body mono selectable>
              {Object.entries(res.headers).map(([k, v]) => `${k}: ${v}`).join('\n') || tr('api.noHeader')}
            </Body>
          ) : (
            <Body mono selectable>
              {prettyBody(res.data).slice(0, MAX_PREVIEW)}
            </Body>
          )}
        </Card>
      ) : null}

      {history.length ? (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Label>{tr('api.history')}</Label>
            <Pressable onPress={() => { setHistory([]); storage.set(storage.StorageKey.API_CLIENT_HISTORY, []); }}>
              <Body muted>{tr('api.clear')}</Body>
            </Pressable>
          </Row>
          {history.map((h, i) => (
            <Pressable key={h.at + '-' + i} onPress={() => { setD({ ...h.draft }); setRes(null); setError(''); }}>
              <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
                <Body mono>{`${h.draft.method} ${h.draft.url}`.slice(0, 48)}</Body>
                {h.status ? <Badge text={String(h.status)} tone={h.status < 300 ? 'success' : 'danger'} /> : <Badge text={tr('api.error')} tone="danger" />}
              </Row>
            </Pressable>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
