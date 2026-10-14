import { getSaoPauloDateString } from '../utils/date';
import React, { useState } from 'react';
import {
  Sparkles,
  CheckCircle2,
  Circle,
  Plus,
  Trash2,
  ArrowRight,
  TrendingUp,
  Calendar,
  Check,
  Zap,
} from 'lucide-react';
import { GoalItem, MemoryItem, ProjectItem, TaskItem, UserProfile } from '../types';
import { Panel, SectionHeader, MetricCard, StatusBadge, Button } from './common/DesignSystem';
import { useCurrentDateTime } from '../hooks/useCurrentDateTime';
import heroMountainArt from '../assets/person-mountain.jpg';

interface DashboardViewProps {
  profile: UserProfile;
  memories: MemoryItem[];
  tasks: TaskItem[];
  goals: GoalItem[];
  projects: ProjectItem[];
  onNavigate: (tab: string) => void;
  onToggleTask: (id: string) => void;
  onOpenQuickMemory: () => void;
  onOpenAIChat: (initialPrompt?: string) => void;
  onAddTask?: (task: Omit<TaskItem, 'id' | 'data'> & { data?: string }) => void;
  onDeleteTask?: (id: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  profile,
  tasks,
  onNavigate,
  onToggleTask,
  onOpenAIChat,
  onAddTask,
  onDeleteTask,
}) => {
  const [newInlineTaskTitle, setNewInlineTaskTitle] = useState('');
  const [isAddingInline, setIsAddingInline] = useState(false);

  const nameToUse = profile.comoSerChamado || profile.nome || 'Wesley';
  const { greeting, fullDate } = useCurrentDateTime(nameToUse);

  // Task Collections
  const completedTasks = tasks.filter((t) => t.concluida || t.status === 'concluida');
  const rescheduledTasks = tasks.filter((t) => t.status === 'adiada');
  const pendingTasks = tasks.filter((t) => !t.concluida && t.status !== 'cancelada' && t.status !== 'adiada');

  const totalTasks = tasks.length;
  const completedCount = completedTasks.length;
  const progressPercent = totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 0;

  // Next Priority Task
  const urgentTasks = pendingTasks.filter((t) => t.prioridade === 'urgente' || t.prioridade === 'alta');
  const importantTasks = pendingTasks.filter((t) => t.prioridade === 'importante' || t.prioridade === 'media');
  const topPriorityTask = urgentTasks[0] || importantTasks[0] || pendingTasks[0];

  const handleInlineTaskSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newInlineTaskTitle.trim()) return;

    if (onAddTask) {
      onAddTask({
        titulo: newInlineTaskTitle.trim(),
        prioridade: 'urgente',
        status: 'pendente',
        categoria: 'geral',
        concluida: false,
        dataCriacao: getSaoPauloDateString(),
      });
    }

    setNewInlineTaskTitle('');
    setIsAddingInline(false);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-16 pt-2 font-sans text-slate-100">
      {/* 1. HERO BANNER: SECRETÁRIO PESSOAL COM ARTE PANORÂMICA */}
      <div className="relative rounded-2xl overflow-hidden border border-blue-900/50 bg-[#070E24] p-6 md:p-8 shadow-2xl">
        {/* Arte Decorativa Superior: Montanhas ao fundo e pessoa no topo */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <img
            src={heroMountainArt}
            alt="Montanhas e conquista"
            className="w-full h-full object-cover object-[75%_30%] md:object-[right_center] scale-105"
            referrerPolicy="no-referrer"
          />
          {/* Máscaras e gradientes de integração com o fundo */}
          <div className="absolute inset-0 bg-gradient-to-r from-[#070C1A] via-[#070C1A]/90 via-55% to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#070C1A] via-transparent to-[#070C1A]/60" />
          <div className="absolute inset-0 bg-blue-950/25 mix-blend-color" />
          <div className="absolute right-0 top-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        </div>

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-cyan-300 bg-blue-950/80 border border-blue-800/60 px-2.5 py-0.5 rounded-lg inline-flex items-center gap-1.5 backdrop-blur-sm">
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                Secretário Pessoal Inteligente
              </span>
              <span className="text-xs font-medium text-slate-400 font-mono">
                {fullDate}
              </span>
            </div>
            <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight drop-shadow-md">
              {greeting}, <span className="text-[#38BDF8]">{nameToUse}!</span>
            </h1>
            <p className="text-xs md:text-sm text-slate-200 leading-relaxed max-w-xl font-light drop-shadow">
              Aqui está sua agenda do dia. Converse com o RAXXER para organizar tarefas, compromissos e anotações instantâneas.
            </p>
          </div>

          <div className="shrink-0 flex flex-col items-start md:items-end gap-1.5">
            <Button
              variant="ai"
              size="lg"
              icon={Sparkles}
              onClick={() => onOpenAIChat()}
              className="w-full md:w-auto shadow-[0_0_25px_rgba(6,182,212,0.4)]"
            >
              Conversar com RAXXER
            </Button>
            <span className="text-[11px] text-slate-400 italic">
              &ldquo;Eu falo. Ele entende. Ele organiza.&rdquo;
            </span>
          </div>
        </div>
      </div>

      {/* 2. MINHA PRIORIDADE AGORA (PRÓXIMA AÇÃO) */}
      <Panel variant="glow" className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-400 flex items-center justify-center font-bold text-sm shadow-[0_0_15px_rgba(245,158,11,0.2)]">
              ⚡
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-tight">
                Minha prioridade agora
              </h2>
              <p className="text-[11px] text-slate-400">Sua próxima ação de maior impacto</p>
            </div>
          </div>
          {topPriorityTask && (
            <StatusBadge label="Próxima Ação" variant="amber" />
          )}
        </div>

        {topPriorityTask ? (
          <div className="p-4 rounded-xl bg-[#081126] border border-blue-800/40 shadow-md flex items-center justify-between gap-4 transition-all">
            <div className="flex items-start gap-3 min-w-0">
              <button
                onClick={() => onToggleTask(topPriorityTask.id)}
                className="mt-0.5 text-slate-500 hover:text-emerald-400 transition-colors shrink-0 cursor-pointer"
                title="Marcar como concluída"
              >
                <Circle className="w-5 h-5 text-amber-400 hover:text-emerald-400" />
              </button>
              <div className="min-w-0">
                <p className="text-sm font-bold text-white leading-snug">
                  🔹 {topPriorityTask.titulo}
                </p>
                {topPriorityTask.notas && (
                  <p className="text-xs text-slate-400 mt-0.5 truncate font-light">
                    {topPriorityTask.notas}
                  </p>
                )}
                {topPriorityTask.data && (
                  <p className="text-[10px] text-cyan-400 font-mono mt-1">
                    📅 {topPriorityTask.data}
                  </p>
                )}
              </div>
            </div>

            <Button
              variant="primary"
              size="sm"
              icon={Check}
              onClick={() => onToggleTask(topPriorityTask.id)}
            >
              Concluir
            </Button>
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-[#081126] border border-blue-900/30 text-center text-xs text-slate-400 italic">
            Nenhuma tarefa pendente para agora. Tudo organizado!
          </div>
        )}
      </Panel>

      {/* 3. CARDS DE RESUMO OPERACIONAL */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <MetricCard
          title="Tarefas do Dia"
          value={totalTasks}
          subtitle="Planejadas hoje"
          icon={Calendar}
          iconColor="text-blue-400"
          iconBg="bg-[#132A54] border border-blue-500/30"
        />
        <MetricCard
          title="Concluídas"
          value={completedCount}
          subtitle={`${progressPercent}% de execução`}
          trend={progressPercent > 50 ? '↑ Alto' : 'Em curso'}
          icon={CheckCircle2}
          iconColor="text-emerald-400"
          iconBg="bg-emerald-950/60 border border-emerald-500/40"
          variant={progressPercent === 100 ? 'highlight' : 'default'}
        />
        <MetricCard
          title="Pendentes"
          value={pendingTasks.length}
          subtitle="Aguardando ação"
          icon={Zap}
          iconColor="text-amber-400"
          iconBg="bg-[#362512] border border-amber-500/30"
        />
        <MetricCard
          title="Adiada / Reagendada"
          value={rescheduledTasks.length}
          subtitle="Para outro dia"
          icon={TrendingUp}
          iconColor="text-purple-400"
          iconBg="bg-[#1E1B4B] border border-purple-500/30"
        />
      </div>

      {/* 4. LISTA DE TAREFAS DO DIA */}
      <Panel variant="default" className="p-6 space-y-4">
        <SectionHeader
          icon={Calendar}
          title="Agenda & Tarefas do Dia"
          subtitle="Acompanhe ou adicione ações rápidas"
          action={
            <Button
              variant="secondary"
              size="sm"
              icon={Plus}
              onClick={() => setIsAddingInline(true)}
            >
              Nova Tarefa
            </Button>
          }
        />

        {/* Inline Add Task Box */}
        {isAddingInline && (
          <form
            onSubmit={handleInlineTaskSubmit}
            className="p-3.5 rounded-xl bg-[#0B1736] border border-blue-500/40 flex items-center gap-3 animate-fadeIn"
          >
            <input
              type="text"
              autoFocus
              placeholder="O que você precisa fazer hoje?"
              value={newInlineTaskTitle}
              onChange={(e) => setNewInlineTaskTitle(e.target.value)}
              className="flex-1 bg-transparent border-none text-xs text-white placeholder:text-slate-500 focus:outline-none"
            />
            <Button type="submit" size="sm" variant="primary">
              Salvar
            </Button>
            <button
              type="button"
              onClick={() => setIsAddingInline(false)}
              className="text-slate-400 hover:text-white text-xs px-2"
            >
              Cancelar
            </button>
          </form>
        )}

        {/* Tasks List */}
        <div className="space-y-2">
          {pendingTasks.length === 0 && !isAddingInline ? (
            <div className="py-8 text-center text-slate-500 text-xs">
              Todas as tarefas foram concluídas! Converse com o RAXXER se quiser planejar os próximos passos.
            </div>
          ) : (
            pendingTasks.map((t) => (
              <div
                key={t.id}
                className="p-3 rounded-xl bg-[#0B1530] border border-blue-900/30 hover:border-blue-700/50 flex items-center justify-between gap-3 transition-colors group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    onClick={() => onToggleTask(t.id)}
                    className="text-slate-500 hover:text-emerald-400 transition-colors shrink-0 cursor-pointer"
                  >
                    <Circle className="w-4 h-4" />
                  </button>
                  <span className="text-xs font-medium text-slate-200 truncate group-hover:text-white">
                    {t.titulo}
                  </span>
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
                  {onDeleteTask && (
                    <button
                      onClick={() => onDeleteTask(t.id)}
                      className="text-slate-600 hover:text-rose-400 p-1 transition-colors"
                      title="Excluir tarefa"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Navigation link to full My Day View */}
        <div className="pt-2 border-t border-blue-900/30 flex items-center justify-between text-xs">
          <span className="text-slate-400">Ver todas as tarefas e blocos de execução:</span>
          <button
            onClick={() => onNavigate('meu_dia')}
            className="text-cyan-400 hover:text-cyan-300 font-semibold inline-flex items-center gap-1 cursor-pointer"
          >
            <span>Acessar Meu Dia</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </Panel>
    </div>
  );
};
