import { useEffect, useState } from 'react';
import { Database, Link2, Loader2, Plus, X } from 'lucide-react';
import {
  getTraeDBSettings,
  saveTraeDBSettings,
  testTraeDBConnection,
  type TraeDBSettings,
} from '../../../api/config';
import { toErrorMessage as formatErrorMessage } from '../../../shared/lib/errorMessage';
import {
  ErrorMsg,
  Field,
  SectionHead,
  Spinner,
  StatusBadge,
} from './SettingsPrimitives';

const inputCls =
  'w-full bg-stone-50 dark:bg-[#171B22] border border-stone-200 dark:border-[#232834] rounded-2xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-400/30 transition-shadow placeholder:text-stone-400';
const btnPrimary =
  'px-5 py-2.5 bg-[#111827] hover:bg-[#1F2937] dark:bg-[#E5EAF2] dark:hover:bg-[#F3F6FB] text-white dark:text-[#0D1117] rounded-full text-sm font-semibold transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2 cursor-default';
const btnSecondary =
  'px-5 py-2.5 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 rounded-2xl text-sm font-semibold transition-colors flex items-center gap-2 cursor-default';

const DEFAULT_SETTINGS: TraeDBSettings = {
  host: '127.0.0.1',
  port: 13306,
  user: 'root',
  dbName: 'solo',
  hasPassword: false,
  userIds: [],
};

export function TraeDBSettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [host, setHost] = useState(DEFAULT_SETTINGS.host);
  const [port, setPort] = useState<number>(DEFAULT_SETTINGS.port);
  const [user, setUser] = useState(DEFAULT_SETTINGS.user);
  const [password, setPassword] = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  const [dbName, setDbName] = useState(DEFAULT_SETTINGS.dbName);
  const [userIds, setUserIds] = useState<string[]>([]);
  const [pendingUserId, setPendingUserId] = useState('');

  const [testing, setTesting] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const s = await getTraeDBSettings();
        if (cancelled) return;
        setHost(s.host || DEFAULT_SETTINGS.host);
        setPort(s.port > 0 ? s.port : DEFAULT_SETTINGS.port);
        setUser(s.user || DEFAULT_SETTINGS.user);
        setDbName(s.dbName || DEFAULT_SETTINGS.dbName);
        setHasPassword(s.hasPassword);
        setUserIds(s.userIds || []);
      } catch (err) {
        if (!cancelled) setLoadError(formatErrorMessage(err, '加载 Trae 数据库配置失败'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const addUserId = () => {
    const v = pendingUserId.trim();
    if (!v) return;
    if (userIds.includes(v)) {
      setPendingUserId('');
      return;
    }
    setUserIds([...userIds, v]);
    setPendingUserId('');
  };

  const removeUserId = (target: string) => {
    setUserIds(userIds.filter((id) => id !== target));
  };

  const handleTest = async () => {
    setTesting(true);
    setError('');
    try {
      const ok = await testTraeDBConnection(host, port, user, password, dbName);
      setTestStatus(ok ? 'success' : 'error');
    } catch (err) {
      setTestStatus('error');
      setError(formatErrorMessage(err, '连接失败'));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await saveTraeDBSettings(host, port, user, password, dbName, userIds);
      setSaveStatus('saved');
      if (password.trim()) setHasPassword(true);
      setPassword('');
      window.setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err) {
      setSaveStatus('error');
      setError(formatErrorMessage(err, '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="max-w-lg animate-in fade-in duration-150">
      <SectionHead
        title="Trae 数据库"
        description="读取 trae solo_coder_smartsheet_records 用于跨设备配额校验和提示词去重"
      />
      {loading ? (
        <Spinner />
      ) : (
        <div className="space-y-5">
          <p className="text-xs text-stone-400 dark:text-stone-500">带 * 的字段为必填项</p>
          {loadError && <ErrorMsg msg={loadError} />}

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Field label="Host" required>
                <input
                  type="text"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="127.0.0.1"
                  className={inputCls}
                />
              </Field>
            </div>
            <Field label="Port" required>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value) || 0)}
                placeholder="13306"
                className={inputCls}
              />
            </Field>
          </div>

          <Field label="User" required>
            <input
              type="text"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder="root"
              className={inputCls}
            />
          </Field>

          <Field
            label="Password"
            required={!hasPassword}
            hint={hasPassword ? '已保存密码；留空则保留当前值' : undefined}
          >
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={hasPassword ? '已保存，留空则保留' : '••••••'}
              className={inputCls}
            />
          </Field>

          <Field label="Database" required>
            <input
              type="text"
              value={dbName}
              onChange={(e) => setDbName(e.target.value)}
              placeholder="solo"
              className={inputCls}
            />
          </Field>

          <Field
            label="Trae 用户 ID 列表"
            hint="跨设备配额合并和兄弟提示词只考虑这里列出的 trae_user_id；留空表示统计全量"
          >
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={pendingUserId}
                  onChange={(e) => setPendingUserId(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addUserId();
                    }
                  }}
                  placeholder="输入 trae_user_id 后回车或点 +"
                  className={inputCls}
                />
                <button onClick={addUserId} className={btnSecondary} type="button">
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              {userIds.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {userIds.map((id) => (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 dark:bg-stone-800 px-3 py-1 text-xs font-medium text-stone-700 dark:text-stone-200"
                    >
                      <Database className="w-3 h-3 opacity-60" />
                      {id}
                      <button
                        type="button"
                        onClick={() => removeUserId(id)}
                        className="ml-1 text-stone-400 hover:text-stone-600 dark:hover:text-stone-100"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </Field>

          {error && <ErrorMsg msg={error} />}

          <div className="pt-5 flex items-center justify-between border-t border-stone-100 dark:border-stone-800">
            <div className="flex items-center gap-3">
              <button
                onClick={handleTest}
                disabled={testing || !host || !user || !dbName}
                className={btnSecondary}
                type="button"
              >
                {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                测试连接
              </button>
              {testStatus === 'success' && <StatusBadge ok>已连接</StatusBadge>}
              {testStatus === 'error' && <StatusBadge>连接失败</StatusBadge>}
            </div>
            <div className="flex items-center gap-3">
              {saveStatus === 'saved' && <StatusBadge ok>已保存</StatusBadge>}
              {saveStatus === 'error' && <StatusBadge>保存失败</StatusBadge>}
              <button
                onClick={handleSave}
                disabled={saving || !host || !user || !dbName}
                className={btnPrimary}
                type="button"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
