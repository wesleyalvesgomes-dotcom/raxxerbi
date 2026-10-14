import { getSaoPauloDateString } from '../utils/date';
import React, { useState } from 'react';
import {
  Plus,
  CheckCircle2,
  Circle,
  Trash2,
  CalendarCheck,
  Sparkles,
  Loader2,
  Flame,
  Star,
  Clock,
  Calendar,
  XCircle,
} from 'lucide-react';
import { TaskItem, TaskPriority, TaskStatus } from '../types';
import { Panel, SectionHeader, MetricCard, StatusBadge, Button } from './common/DesignSystem';

interface MyDayViewProps {
  tasks: TaskItem[];
  onAddTask: (newTask: Omit<TaskItem, 'id' | 'data'>) => void;
  onToggleTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onUpdateTaskPriority: (id: string, newPriority: TaskPriority) => void;
  onUpdateTaskStatus?: (id: string, newStatus: TaskStatus) => void;
  onOpenAIChat: (prompt?: string) => void;
}

export const MyDayView: React.FC<MyDayViewProps> = ({
  tasks,
  onAddTask,
  onToggleTask,
  onDeleteTask,
  onUpdateTaskPriority,
  onUpdateTaskStatus,
  onOpenAIChat,
}) => {
  const [titulo, setTitulo] = useState('');
  const [prioridade, setPrioridade] = useState<TaskPriority>('importante');
  const [categoria, setCategoria] = useState<string>('geral');
  const [notas, setNotas] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [dayReview, setDayReview] = useState<string | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('todas');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!titulo.trim()) return;

    onAddTask({
      titulo: titulo.trim(),
      prioridade,
      status: 'pendente',
      categoria,
      notas: notas.trim() || undefined,
      concluida: false,
      dataCriacao: getSaoPauloDateString(),
    });

    setTitulo('');
    setNotas('');
    setIsAdding(false);
  };

  const handleEndOfDayReview = async () => {
    setIsReviewing(true);
    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message:
            'Gere um fechamento do meu dia resumindo o que foi concluído, as pendências que sobraram e me dê uma orientação motivadora e objetiva para o dia seguinte.',
          systemContext: JSON.stringify({ tasks }),
        }),
      });

      if (!response.ok) throw new Error('Falha ao comunicar com IA');
      const data = await response.json();
      setDayReview(data.text || 'Dia analisado com sucesso pelo copiloto.');
    } catch (err) {
      setDayReview(
        'Excelente trabalho hoje! Você manteve consistência no cumprimento das tarefas. Amanhã priorize os compromissos em aberto.'
      );
    } finally {
      setIsReviewing(false);
    }
  };

  const completedCount = tasks.filter((t) => t.concluida || t.status === 'concluida').length;
  const pendingCount = tasks.filter((t) => !t.concluida && t.status !== 'cancelada').length;
  const highPriorityCount = tasks.filter(
    (t) => !t.concluida && (t.prioridade === 'alta' || t.prioridade === 'urgente')
  ).length;

  const filteredTasks = tasks.filter((t) => {
    if (filterStatus === 'pendentes') return !t.concluida && t.status !== 'cancelada';
    if (filterStatus === 'concluidas') return t.concluida || t.status === 'concluida';
    if (filterStatus === 'urgentes')
      return !t.concluida && (t.prioridade === 'alta' || t.prioridade === 'urgente');
    return true;
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-16 pt-2 font-sans text-slate-100">
      {/* Top Banner Meu Dia */}
      <div className="relative rounded-2xl overflow-hidden border border-blue-900/40 bg-gradient-to-r from-[#091530] via-[#0D1C44] to-[#112356] p-6 md:p-8 shadow-xl">
        <div className="absolute right-0 top-0 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-cyan-300 bg-blue-950/80 border border-blue-800/60 px-2.5 py-0.5 rounded-lg inline-flex items-center gap-1.5">
                <CalendarCheck className="w-3.5 h-3.5 text-cyan-400" />
                Meu Dia & Execução
              </span>
            </div>
            <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight">
              Foco & Produtividade Diária
            </h1>
            <p className="text-xs md:text-sm text-slate-300 leading-relaxed max-w-xl font-light">
              Mantenha o controle de cada atividade, priorize ações de alto impacto e feche o dia com clareza.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              size="md"
              icon={isReviewing ? Loader2 : Sparkles}
              disabled={isReviewing}
              onClick={handleEndOfDayReview}
            >
              {isReviewing ? 'Analisando...' : 'Fechamento do Dia'}
            </Button>
            <Button
              variant="primary"
              size="md"
              icon={Plus}
              onClick={() => setIsAdding(true)}
            >
              Nova Tarefa
            </Button>
          </div>
        </div>
      </div>

      {/* Métricas do Dia */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard
          title="Pendentes Hoje"
          value={pendingCount}
          subtitle="Tarefas ativas"
          icon={Clock}
          iconColor="text-blue-400"
          iconBg="bg-[#132A54] border border-blue-500/30"
        />
        <MetricCard
          title="Concluídas"
          value={completedCount}
          subtitle="Ações executadas"
          icon={CheckCircle2}
          iconColor="text-emerald-400"
          iconBg="bg-emerald-950/60 border border-emerald-500/40"
          variant={completedCount > 0 && pendingCount === 0 ? 'highlight' : 'default'}
        />
        <MetricCard
          title="Prioridade Alta"
          value={highPriorityCount}
          subtitle="Requerem urgência"
          icon={Flame}
          iconColor="text-rose-400"
          iconBg="bg-rose-950/60 border border-rose-500/30"
        />
      </div>

      {/* Feedback do Fechamento do Dia */}
      {dayReview && (
        <Panel variant="glow" className="p-6 space-y-3 animate-fadeIn">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-bold text-white">Análise do Copiloto RAXXER</h3>
            </div>
            <button
              onClick={() => setDayReview(null)}
              className="text-slate-400 hover:text-white text-xs"
            >
              Fechar
            </button>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed font-light whitespace-pre-line bg-[#081126] p-4 rounded-xl border border-blue-900/40">
            {dayReview}
          </p>
        </Panel>
      )}

      {/* Formulário de Adicionar Tarefa */}
      {isAdding && (
        <Panel variant="glow" className="p-6 space-y-4 animate-fadeIn">
          <SectionHeader
            icon={Plus}
            title="Nova Ação / Tarefa"
            subtitle="Insira detalhes para o seu plano do dia"
          />

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-slate-300">O que precisa ser feito?</label>
              <input
                type="text"
                autoFocus
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Ex: Ligar para cliente sobre proposta do Jardins"
                className="w-full mt-1.5 px-3.5 py-2.5 rounded-xl bg-[#081126] border border-blue-900/50 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-300">Prioridade</label>
                <select
                  value={prioridade}
                  onChange={(e) => setPrioridade(e.target.value as TaskPriority)}
                  className="w-full mt-1.5 px-3.5 py-2.5 rounded-xl bg-[#081126] border border-blue-900/50 text-white text-xs focus:outline-none focus:border-blue-500"
                >
                  <option value="urgente">⚡ Urgente</option>
                  <option value="alta">🔥 Alta</option>
                  <option value="importante">⭐ Importante</option>
                  <option value="media">🔹 Média</option>
                  <option value="baixa">☕ Baixa</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300">Categoria</label>
                <select
                  value={categoria}
                  onChange={(e) => setCategoria(e.target.value)}
                  className="w-full mt-1.5 px-3.5 py-2.5 rounded-xl bg-[#081126] border border-blue-900/50 text-white text-xs focus:outline-none focus:border-blue-500"
                >
                  <option value="geral">Geral</option>
                  <option value="comercial">Comercial / INC</option>
                  <option value="pessoal">Pessoal / Saúde</option>
                  <option value="financeiro">Financeiro</option>
                  <option value="direcao">Direção / Estudos</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300">Notas adicionais (opcional)</label>
              <textarea
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                placeholder="Detalhes, contatos ou observações..."
                rows={2}
                className="w-full mt-1.5 px-3.5 py-2.5 rounded-xl bg-[#081126] border border-blue-900/50 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setIsAdding(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" variant="primary" size="sm">
                Adicionar Tarefa
              </Button>
            </div>
          </form>
        </Panel>
      )}

      {/* Lista Principal de Tarefas */}
      <Panel variant="default" className="p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-blue-900/30">
          <div className="flex items-center gap-2">
            <CalendarCheck className="w-4 h-4 text-cyan-400" />
            <h2 className="text-sm font-bold text-white">Tarefas & Compromissos</h2>
          </div>

          {/* Filtros em Tabs */}
          <div className="flex items-center gap-1.5 bg-[#081126] p-1 rounded-xl border border-blue-900/40">
            {['todas', 'pendentes', 'urgentes', 'concluidas'].map((f) => (
              <button
                key={f}
                onClick={() => setFilterStatus(f)}
                className={`px-3 py-1 rounded-lg text-xs font-medium capitalize transition-all cursor-pointer ${
                  filterStatus === f
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Itens */}
        <div className="space-y-2">
          {filteredTasks.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-xs italic">
              Nenhuma tarefa encontrada neste filtro.
            </div>
          ) : (
            filteredTasks.map((t) => {
              const isDone = t.concluida || t.status === 'concluida';

              return (
                <div
                  key={t.id}
                  className={`p-3.5 rounded-xl border transition-all flex items-start justify-between gap-3 group ${
                    isDone
                      ? 'bg-[#080F22]/50 border-blue-950/50 opacity-60'
                      : 'bg-[#0B1530] border-blue-900/30 hover:border-blue-700/50'
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <button
                      onClick={() => onToggleTask(t.id)}
                      className="mt-0.5 text-slate-500 hover:text-emerald-400 transition-colors shrink-0 cursor-pointer"
                    >
                      {isDone ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                      ) : (
                        <Circle className="w-5 h-5" />
                      )}
                    </button>
                    <div className="min-w-0">
                      <p
                        className={`text-xs font-semibold leading-snug ${
                          isDone ? 'line-through text-slate-400' : 'text-slate-100 group-hover:text-white'
                        }`}
                      >
                        {t.titulo}
                      </p>
                      {t.notas && (
                        <p className="text-[11px] text-slate-400 mt-0.5 truncate font-light">
                          {t.notas}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        {t.categoria && (
                          <span className="text-[10px] text-blue-300/80 bg-blue-950/60 px-2 py-0.5 rounded border border-blue-800/40">
                            {t.categoria}
                          </span>
                        )}
                        {t.data && (
                          <span className="text-[10px] text-slate-400 font-mono">
                            📅 {t.data}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {t.prioridade && (
                      <StatusBadge
                        label={t.prioridade.toUpperCase()}
                        variant={
                          t.prioridade === 'urgente' || t.prioridade === 'alta'
                            ? 'rose'
                            : t.prioridade === 'importante' || t.prioridade === 'media'
                            ? 'amber'
                            : 'blue'
                        }
                      />
                    )}
                    <button
                      onClick={() => onDeleteTask(t.id)}
                      className="text-slate-600 hover:text-rose-400 p-1 transition-colors"
                      title="Excluir tarefa"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Panel>
    </div>
  );
};
