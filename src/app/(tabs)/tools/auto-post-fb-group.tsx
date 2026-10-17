import { useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { ResultList, ToolGate } from '@/components/tool';
import { Badge, Body, Button, Card, Field, Label, NumberField, Row, Screen, useColors } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { createGroupPost } from '@/lib/fb/Group';

interface Target {
  id: string;
  status?: 'done' | 'loading' | 'error';
  note?: string;
}

/** Lấy group id từ URL hoặc UID thô. */
function parseGroupId(line: string): string | null {
  const s = line.trim();
  if (!s) return null;
  const m = s.match(/groups\/(?:[^/]*-)?(\d+)/) || s.match(/groups\/([A-Za-z0-9.]+)/);
  if (m) return m[1];
  if (/^\d+$/.test(s)) return s;
  return null;
}

function Runner({ dtsg }: { dtsg: string }) {
  const c = useColors();
  const tr = useT();
  const [text, setText] = useState('');
  const [groupsRaw, setGroupsRaw] = useState('');
  const [delay, setDelay] = useState(60);
  const [limit, setLimit] = useState(20);
  const [running, setRunning] = useState(false);
  const [targets, setTargets] = useState<Target[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const stopRef = useRef(false);

  const addLog = (m: string) => setLog((p) => [`${new Date().toLocaleTimeString()} — ${m}`, ...p].slice(0, 60));

  const start = async () => {
    if (running) return;
    const ids = Array.from(
      new Set(groupsRaw.split('\n').map(parseGroupId).filter((x): x is string => !!x)),
    ).slice(0, limit);
    if (!text.trim()) {
      addLog(tr('tool.noContent'));
      return;
    }
    if (ids.length === 0) {
      addLog(tr('tool.noValidGroups'));
      return;
    }
    stopRef.current = false;
    setRunning(true);
    setLog([]);
    const list: Target[] = ids.map((id) => ({ id }));
    setTargets(list);

    for (let i = 0; i < list.length; i++) {
      if (stopRef.current) break;
      setTargets((prev) => prev.map((t, idx) => (idx === i ? { ...t, status: 'loading' } : t)));
      const res = await createGroupPost({ dtsg, groupId: list[i].id, text });
      setTargets((prev) =>
        prev.map((t, idx) =>
          idx === i ? { ...t, status: res.success ? 'done' : 'error', note: res.error } : t,
        ),
      );
      addLog(res.success ? tr('tool.logPosted', { id: list[i].id }) + (res.postId ? ` (#${res.postId})` : '') : tr('tool.logPostErr', { id: list[i].id, err: res.error ?? '' }));
      if (i < list.length - 1 && !stopRef.current) {
        await new Promise((r) => setTimeout(r, delay * 1000));
      }
    }
    setRunning(false);
    addLog(tr('tool.doneLog'));
  };

  const done = targets.filter((t) => t.status === 'done').length;

  return (
    <>
      <Card>
        <Field label={tr('tool.postContent')} value={text} onChangeText={setText} multiline placeholder={tr('tool.postContentPh')} />
        <Field
          label={tr('tool.groupListLabel')}
          value={groupsRaw}
          onChangeText={setGroupsRaw}
          multiline
          placeholder={'123456789\nhttps://www.facebook.com/groups/abc-987654321'}
        />
        <Row>
          <View style={{ flex: 1 }}>
            <NumberField label={tr('tool.delaySec')} value={delay} onChange={setDelay} min={0} max={3600} icon="time-outline" />
          </View>
          <View style={{ flex: 1 }}>
            <NumberField label={tr('tool.limitGroups')} value={limit} onChange={setLimit} min={1} max={500} icon="list-outline" />
          </View>
        </Row>
        {running ? (
          <Button title={tr('tool.stop')} variant="danger" icon="stop" onPress={() => { stopRef.current = true; setRunning(false); }} />
        ) : (
          <Button title={tr('tool.startPost')} icon="send" onPress={start} disabled={!text.trim() || !groupsRaw.trim()} />
        )}
      </Card>

      {targets.length ? (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Label>{tr('tool.groupsDone', { done, total: targets.length })}</Label>
          </Row>
          <ResultList
            items={targets}
            keyOf={(t) => t.id}
            render={(t) => (
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.text, fontWeight: '600' }}>{t.id}</Text>
                  {t.note ? <Body muted size={12} numberOfLines={2}>{t.note}</Body> : null}
                </View>
                <Badge
                  text={t.status === 'done' ? tr('tool.st.posted') : t.status === 'error' ? tr('tool.st.error') : t.status === 'loading' ? '...' : tr('tool.st.waiting')}
                  tone={t.status === 'done' ? 'success' : t.status === 'error' ? 'danger' : 'muted'}
                />
              </Row>
            )}
          />
        </Card>
      ) : null}

      {log.length ? (
        <Card>
          <Label>{tr('tool.log')}</Label>
          {log.map((l, i) => <Body key={i} muted size={13}>{l}</Body>)}
        </Card>
      ) : null}
    </>
  );
}

export default function AutoPostFbGroupScreen() {
  return (
    <Screen>
      <ToolGate require="plan">{(dtsg) => <Runner dtsg={dtsg} />}</ToolGate>
    </Screen>
  );
}
