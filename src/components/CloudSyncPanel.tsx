import React, { useMemo, useState } from 'react';
import { Cloud, CloudUpload, Download, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { CLOUD_SYNC_CONFLICTS_KEY, CLOUD_SYNC_ENABLED_KEY, CLOUD_SYNC_ERROR_KEY, CLOUD_SYNC_PENDING_ACTIVATION_KEY, CLOUD_SYNC_STATUS_EVENT, CLOUD_SYNC_VERSIONS_KEY } from '../services/cloudSync';

type LocalMapping = { key: string; collection: string; shape: 'array' | 'object'; idField?: string };

const MAPPINGS: LocalMapping[] = [
  { key: 'sb_profile', collection: 'profile', shape: 'object' },
  { key: 'sb_tasks', collection: 'tasks', shape: 'array' },
  { key: 'sb_goals', collection: 'goals', shape: 'array' },
  { key: 'sb_memories', collection: 'memories', shape: 'array' },
  { key: 'sb_projects', collection: 'projects', shape: 'array' },
  { key: 'sb_daily_history', collection: 'daily_history', shape: 'array', idField: 'data' },
  { key: 'sb_reviews', collection: 'weekly_reviews', shape: 'array' },
  { key: 'raxxer_com_leads', collection: 'commercial_leads', shape: 'array' },
  { key: 'raxxer_com_lead_history', collection: 'commercial_lead_history', shape: 'array' },
  { key: 'raxxer_com_interactions', collection: 'commercial_interactions', shape: 'array' },
  { key: 'raxxer_com_visits', collection: 'commercial_visits', shape: 'array' },
  { key: 'raxxer_com_proposals', collection: 'commercial_proposals', shape: 'array' },
  { key: 'raxxer_com_sales', collection: 'commercial_sales', shape: 'array' },
  { key: 'raxxer_com_goals', collection: 'commercial_goals', shape: 'array' },
];

type CloudRecord = { id: string; data: unknown; updatedAt?: string };
type SyncStats = { uploaded: number; downloaded: number; conflicts: number; ignored: number };
type ScheduledJob = { id: string; job_type: string; status: string; run_at: string; recurrence: 'once' | 'daily' | 'weekly'; attempt_count: number; last_error?: string | null };
type ScheduledOutput = { id: string; title: string; summary: string; createdAt: string; date: string; stats?: { openTasks: number; dueToday: number; overdueTasks: number; activeGoals: number } };

function defaultLocalDateTime(): string {
  const date = new Date(Date.now() + 10 * 60 * 1000);
  date.setSeconds(0, 0);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function parseLocal(mapping: LocalMapping): CloudRecord[] {
  const raw = localStorage.getItem(mapping.key);
  if (!raw) return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('O dado local "' + mapping.key + '" não contém JSON válido.'); }
  if (mapping.shape === 'object') {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? [{ id: 'profile', data: value }]
      : [];
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: any) => {
    if (!item || typeof item !== 'object') return [];
    const rawId = mapping.idField ? item[mapping.idField] : item.id;
    if (typeof rawId !== 'string' || !rawId.trim()) return [];
    // Known legacy seed IDs are never uploaded as user data.
    if (/^(task|goal|proj|mem|review)-\d+$/.test(rawId)) return [];
    return [{ id: rawId, data: item }];
  });
}

async function requestJson(path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = typeof body.error === 'string' ? body.error : 'Falha na comunicação com o servidor.';
    const error = new Error(response.status === 401 ? 'Acesso não autenticado. Entre pelo Cloudflare Access e tente novamente.' : reason) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return body;
}

export const CloudSyncPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [lastStats, setLastStats] = useState<SyncStats | null>(null);
  const [jobType, setJobType] = useState<'daily_briefing' | 'weekly_review'>('daily_briefing');
  const [recurrence, setRecurrence] = useState<'once' | 'daily' | 'weekly'>('once');
  const [runAtLocal, setRunAtLocal] = useState(defaultLocalDateTime);
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [outputs, setOutputs] = useState<ScheduledOutput[]>([]);
  const [autonomyLoaded, setAutonomyLoaded] = useState(false);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
  const [autoSyncError, setAutoSyncError] = useState('');
  const [syncConflicts, setSyncConflicts] = useState<Array<{ collection: string; id: string; detectedAt: string }>>([]);

  React.useEffect(() => {
    const refreshSyncStatus = () => {
      setAutoSyncEnabled(localStorage.getItem(CLOUD_SYNC_ENABLED_KEY) === 'true');
      setAutoSyncError(localStorage.getItem(CLOUD_SYNC_ERROR_KEY) || '');
      try { setSyncConflicts(JSON.parse(localStorage.getItem(CLOUD_SYNC_CONFLICTS_KEY) || '[]')); }
      catch { setSyncConflicts([]); }
    };
    refreshSyncStatus();
    window.addEventListener(CLOUD_SYNC_STATUS_EVENT, refreshSyncStatus);
    return () => window.removeEventListener(CLOUD_SYNC_STATUS_EVENT, refreshSyncStatus);
  }, []);
  const totalLocalRecords = useMemo(() => {
    try { return MAPPINGS.reduce((sum, mapping) => sum + parseLocal(mapping).length, 0); }
    catch { return 0; }
  }, []);

  const loadAutonomy = async () => {
    setBusy(true);
    setError('');
    try {
      const [jobsResponse, outputResponse] = await Promise.all([
        requestJson('/api/jobs'),
        requestJson('/api/data/scheduled_outputs'),
      ]);
      setJobs(Array.isArray(jobsResponse.jobs) ? jobsResponse.jobs : []);
      setOutputs(Array.isArray(outputResponse.items) ? outputResponse.items.map((item: CloudRecord) => item.data as ScheduledOutput) : []);
      setAutonomyLoaded(true);
      setMessage('Agendamentos e resultados carregados.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar os agendamentos.');
    } finally {
      setBusy(false);
    }
  };

  const createScheduledJob = async () => {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const response = await requestJson('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({
          type: jobType,
          runAt: new Date(runAtLocal).toISOString(),
          recurrence,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      setMessage(response.reused ? 'Este agendamento já existia; nenhum duplicado foi criado.' : 'Agendamento criado. O Worker executará o resumo no horário definido.');
      await loadAutonomy();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar o agendamento.');
    } finally {
      setBusy(false);
    }
  };

  const cancelScheduledJob = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      await requestJson('/api/jobs/' + encodeURIComponent(id), { method: 'DELETE' });
      setMessage('Agendamento cancelado.');
      await loadAutonomy();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível cancelar o agendamento.');
    } finally {
      setBusy(false);
    }
  };

  const exportBackup = () => {
    const snapshot: Record<string, unknown> = {};
    for (const mapping of MAPPINGS) {
      const raw = localStorage.getItem(mapping.key);
      if (raw !== null) {
        try { snapshot[mapping.key] = JSON.parse(raw); }
        catch { snapshot[mapping.key] = raw; }
      }
    }
    const blob = new Blob([JSON.stringify({ app: 'RAXXER BI', exportedAt: new Date().toISOString(), data: snapshot }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'raxxer-bi-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage('Backup local exportado. Guarde o arquivo em um local seguro.');
    setError('');
  };

  const syncWithoutOverwrite = async () => {
    setBusy(true);
    setMessage('');
    setError('');
    const stats: SyncStats = { uploaded: 0, downloaded: 0, conflicts: 0, ignored: 0 };
    let versions: Record<string, Record<string, string>> = {};
    try { versions = JSON.parse(localStorage.getItem(CLOUD_SYNC_VERSIONS_KEY) || '{}'); } catch { versions = {}; }
    localStorage.setItem(CLOUD_SYNC_ENABLED_KEY, 'false');
    localStorage.removeItem(CLOUD_SYNC_PENDING_ACTIVATION_KEY);
    setAutoSyncEnabled(false);
    try {
      await requestJson('/api/me');
      for (const mapping of MAPPINGS) {
        const localRecords = parseLocal(mapping);
        const remoteResponse = await requestJson('/api/data/' + mapping.collection);
        const remoteRecords: CloudRecord[] = Array.isArray(remoteResponse.items) ? remoteResponse.items : [];
        const remoteById = new Map(remoteRecords.map((record) => [record.id, record]));
        const localById = new Map(localRecords.map((record) => [record.id, record]));
        const collectionVersions = versions[mapping.collection] || {};

        // Initial migration only inserts missing records; a conflict never overwrites cloud data.
        for (const record of localRecords) {
          const remote = remoteById.get(record.id);
          if (remote) {
            stats.conflicts += 1;
            if (remote.updatedAt) collectionVersions[record.id] = remote.updatedAt;
            continue;
          }
          try {
            const saved = await requestJson('/api/data/' + mapping.collection + '/' + encodeURIComponent(record.id), {
              method: 'PUT',
              body: JSON.stringify({ data: record.data, expectedUpdatedAt: null }),
            });
            if (saved.updatedAt) collectionVersions[record.id] = saved.updatedAt;
            stats.uploaded += 1;
          } catch (err) {
            if ((err as Error & { status?: number }).status === 409) {
              stats.conflicts += 1;
              continue;
            }
            throw err;
          }
        }

        // Pull only records missing locally. Local values win every conflict.
        const merged = new Map(localById);
        for (const record of remoteRecords) {
          if (record.updatedAt) collectionVersions[record.id] = record.updatedAt;
          if (merged.has(record.id)) continue;
          merged.set(record.id, record);
          stats.downloaded += 1;
        }
        versions[mapping.collection] = collectionVersions;
        if (mapping.shape === 'object') {
          const profile = merged.get('profile');
          if (profile && !localStorage.getItem(mapping.key)) {
            localStorage.setItem(mapping.key, JSON.stringify(profile.data));
          }
        } else {
          const items = Array.from(merged.values()).map((record) => record.data);
          // Do not create empty storage keys that would change the app's fallback behavior.
          if (items.length || localStorage.getItem(mapping.key) !== null) {
            localStorage.setItem(mapping.key, JSON.stringify(items));
          }
        }
      }
      localStorage.setItem(CLOUD_SYNC_VERSIONS_KEY, JSON.stringify(versions));
      localStorage.setItem(CLOUD_SYNC_ENABLED_KEY, 'false');
      localStorage.setItem(CLOUD_SYNC_PENDING_ACTIVATION_KEY, 'true');
      localStorage.removeItem(CLOUD_SYNC_ERROR_KEY);
      setAutoSyncEnabled(false);
      setLastStats(stats);
      setMessage('Migração concluída. Recarregue o RAXXER para ativar a sincronização contínua e carregar os dados recebidos.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível sincronizar. Os dados locais foram mantidos.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="cloud-sync-title">
      <section className="w-full max-w-xl rounded-2xl border border-blue-800/50 bg-[#081225] p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-2.5 text-cyan-300"><Cloud className="h-5 w-5" /></div>
            <div>
              <h2 id="cloud-sync-title" className="text-lg font-bold text-white">Dados e sincronização</h2>
              <p className="text-sm text-slate-400">Armazenamento local e Cloudflare D1</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Fechar"><X className="h-5 w-5" /></button>
        </div>

        <div className="mt-5 rounded-xl border border-slate-700 bg-slate-900/60 p-4">
          <div className="flex gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
            <div className="text-sm text-slate-300">
              <p className="font-semibold text-white">Migração não destrutiva</p>
              <p className="mt-1 leading-relaxed">A migração inicial só acontece quando você manda. Depois da ativação, alterações locais são enviadas automaticamente com controle de versão. A migração não sobrescreve registros existentes e os dados locais não são apagados.</p>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-slate-800 p-3">
            <p className="text-xs text-slate-400">Registros locais elegíveis</p>
            <p className="mt-1 text-2xl font-bold text-white">{totalLocalRecords}</p>
          </div>
          <div className="rounded-xl border border-slate-800 p-3">
            <p className="text-xs text-slate-400">Coleções cobertas</p>
            <p className="mt-1 text-2xl font-bold text-white">{MAPPINGS.length}</p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900/50 p-3 text-sm">
          <p className="font-semibold text-white">Sincronização contínua: <span className={autoSyncEnabled ? 'text-emerald-300' : 'text-slate-400'}>{autoSyncEnabled ? 'ativa' : 'ainda não ativada'}</span></p>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">Após a migração, alterações locais são enviadas automaticamente. Escritas usam controle otimista de versão para bloquear sobrescritas se outro dispositivo alterou o mesmo registro.</p>
          {autoSyncError && <p role="alert" className="mt-2 text-xs text-red-300">{autoSyncError}</p>}
          {syncConflicts.length > 0 && <div className="mt-2 text-xs text-amber-200">
            <p>{syncConflicts.length} conflito(s) detectado(s). Os registros foram preservados; revise antes de editar novamente.</p>
            <ul className="mt-2 space-y-1 text-slate-300">
              {syncConflicts.slice(0, 5).map((conflict, index) => <li key={conflict.collection + ':' + conflict.id + ':' + index} className="break-all">{conflict.collection} · {conflict.id}</li>)}
            </ul>
            {syncConflicts.length > 5 && <p className="mt-1 text-slate-400">Mais {syncConflicts.length - 5} conflito(s) no registro local.</p>}
            <button onClick={() => { localStorage.removeItem(CLOUD_SYNC_CONFLICTS_KEY); setSyncConflicts([]); }} className="mt-2 rounded-lg border border-amber-800/60 px-2.5 py-1.5 text-amber-100 hover:bg-amber-950/40">Limpar avisos (não altera dados)</button>
          </div>}
        </div>
        {lastStats && <div className="mt-4 rounded-xl border border-blue-800/50 bg-blue-950/30 p-3 text-sm text-slate-200">
          <p>Enviados: <strong>{lastStats.uploaded}</strong> · Recebidos: <strong>{lastStats.downloaded}</strong></p>
          <p>Conflitos preservados: <strong>{lastStats.conflicts}</strong> · Registros ignorados: <strong>{lastStats.ignored}</strong></p>
        </div>}
        {message && <p className="mt-4 rounded-lg border border-emerald-800/50 bg-emerald-950/30 p-3 text-sm text-emerald-200">{message}</p>}
        {error && <p role="alert" className="mt-4 rounded-lg border border-red-800/50 bg-red-950/30 p-3 text-sm text-red-200">{error}</p>}

        <div className="mt-5 rounded-xl border border-slate-700 bg-slate-900/40 p-4">
          <div className="flex items-start gap-3">
            <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" />
            <div>
              <p className="font-semibold text-white">Execução autônoma agendada</p>
              <p className="mt-1 text-sm leading-relaxed text-slate-400">Agende resumos com base apenas nas tarefas e metas que já existem. O RAXXER não cria tarefas nem metas automaticamente.</p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-slate-300">Tipo de resumo
              <select value={jobType} onChange={(event) => setJobType(event.target.value as 'daily_briefing' | 'weekly_review')} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#07101F] px-3 py-2.5 text-sm text-white">
                <option value="daily_briefing">Resumo diário</option>
                <option value="weekly_review">Revisão semanal</option>
              </select>
            </label>
            <label className="text-xs font-medium text-slate-300">Frequência
              <select value={recurrence} onChange={(event) => setRecurrence(event.target.value as 'once' | 'daily' | 'weekly')} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#07101F] px-3 py-2.5 text-sm text-white">
                <option value="once">Uma vez</option>
                <option value="daily">Todos os dias</option>
                <option value="weekly">Toda semana</option>
              </select>
            </label>
            <label className="text-xs font-medium text-slate-300 sm:col-span-2">Primeira execução
              <input type="datetime-local" value={runAtLocal} onChange={(event) => setRunAtLocal(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#07101F] px-3 py-2.5 text-sm text-white" />
            </label>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button onClick={createScheduledJob} disabled={busy || !runAtLocal} className="flex-1 rounded-xl bg-blue-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-blue-500 disabled:opacity-60">Criar agendamento</button>
            <button onClick={loadAutonomy} disabled={busy} className="rounded-xl border border-slate-700 px-3 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-60">Ver execuções</button>
          </div>
          {autonomyLoaded && <div className="mt-4 space-y-3">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Agendamentos recentes</p>
              {jobs.length === 0 ? <p className="text-sm text-slate-500">Nenhum agendamento encontrado.</p> : jobs.slice(0, 8).map((job) => (
                <div key={job.id} className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-slate-800 p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">{job.job_type === 'weekly_review' ? 'Revisão semanal' : 'Resumo diário'} · {job.recurrence === 'daily' ? 'diário' : job.recurrence === 'weekly' ? 'semanal' : 'uma vez'}</p>
                    <p className="mt-1 text-xs text-slate-400">{new Date(job.run_at).toLocaleString('pt-BR')} · {job.status}</p>
                    {job.last_error && <p className="mt-1 text-xs text-red-300">{job.last_error}</p>}
                  </div>
                  {job.status === 'pending' && <button onClick={() => cancelScheduledJob(job.id)} disabled={busy} className="shrink-0 rounded-lg border border-red-900/70 px-2.5 py-1.5 text-xs text-red-200 hover:bg-red-950/50">Cancelar</button>}
                </div>
              ))}
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Resultados gerados</p>
              {outputs.length === 0 ? <p className="text-sm text-slate-500">Ainda não há resultados. O Worker verifica a fila a cada cinco minutos.</p> : outputs.slice(0, 5).map((output) => (
                <article key={output.id} className="mb-2 rounded-lg border border-slate-800 p-3">
                  <p className="text-sm font-semibold text-white">{output.title || 'Resumo do RAXXER'}</p>
                  <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-300">{output.summary}</p>
                  <p className="mt-2 text-xs text-slate-500">{output.createdAt ? new Date(output.createdAt).toLocaleString('pt-BR') : output.date}</p>
                </article>
              ))}
            </div>
          </div>}
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button onClick={syncWithoutOverwrite} disabled={busy} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-wait disabled:opacity-60">
            {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
            {busy ? 'Sincronizando…' : 'Sincronizar sem sobrescrever'}
          </button>
          <button onClick={exportBackup} disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-60">
            <Download className="h-4 w-4" /> Exportar backup
          </button>
        </div>
        {message.includes('Recarregue') && <button onClick={() => window.location.reload()} className="mt-3 w-full rounded-xl border border-blue-700/60 px-4 py-2.5 text-sm font-semibold text-blue-200 hover:bg-blue-950/50">Recarregar aplicação</button>}
        <p className="mt-4 text-xs leading-relaxed text-slate-500">A sincronização requer Cloudflare Access e D1 configurados. Se a API estiver indisponível, a aplicação mantém os dados locais. O backup inclui dados pessoais e comerciais; mantenha-o protegido.</p>
      </section>
    </div>
  );
};
