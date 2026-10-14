import React, { useState, useEffect } from 'react';
import { Menu, Bot, Cloud } from 'lucide-react';
import { Header } from './components/Header';
import { DashboardView } from './components/DashboardView';
import { MyDayView } from './components/MyDayView';
import { GoalsProjectsView } from './components/GoalsProjectsView';
import { MemoryBrainView } from './components/MemoryBrainView';
import { WeeklyReviewView } from './components/WeeklyReviewView';
import { EvolutionView } from './components/EvolutionView';
import { InterviewWizard } from './components/InterviewWizard';
import { AIChatDrawer } from './components/AIChatDrawer';
import { QuickMemoryModal } from './components/QuickMemoryModal';
import { LeadsView } from './components/LeadsView';
import { SalesFunnelView } from './components/SalesFunnelView';
import { SalesView } from './components/SalesView';
import { CommercialBIDashboard } from './components/CommercialBIDashboard';
import { Sidebar } from './components/Sidebar';
import { useCommercialData } from './hooks/useCommercialData';
import { CloudSyncPanel } from './components/CloudSyncPanel';
import { initializeCloudSync } from './services/cloudSync';

import {
  DailyHistoryLog,
  GoalItem,
  MemoryCategory,
  MemoryImportance,
  MemoryItem,
  ProjectItem,
  TaskItem,
  TaskPriority,
  TaskStatus,
  UserProfile,
  WeeklyReview,
} from './types';

import { DEFAULT_USER_PROFILE } from './utils/initialData';
import { getSaoPauloDateString, getSaoPauloWeekday } from './utils/date';

function persistLocalState(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent('raxxer_storage_change', { detail: { key } }));
}

// Helper to sanitize local storage data and strip legacy seed or "Alex" references
const getSanitizedLocalStorage = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;

    const parsed = JSON.parse(raw);

    if (key === 'sb_profile') {
      const p = parsed as UserProfile;
      return {
        ...DEFAULT_USER_PROFILE,
        ...p,
        nome: p.nome && p.nome !== 'Usuário' ? p.nome : DEFAULT_USER_PROFILE.nome,
        comoSerChamado: p.comoSerChamado || DEFAULT_USER_PROFILE.comoSerChamado,
      } as unknown as T;
    }

    if (Array.isArray(parsed)) {
      // Filter out legacy pre-seeded mock items
      const isLegacySeedId = (id: string) => /^(task|goal|proj|mem|review)-\d+$/.test(id);
      const filtered = parsed.filter((item: any) => {
        if (!item) return false;
        // Remove only stable legacy seed IDs. Never discard a user's real record
        // merely because its title happens to resemble an old example.
        if (item.id && isLegacySeedId(String(item.id))) return false;
        return true;
      });
      return filtered as unknown as T;
    }

    return parsed;
  } catch (e) {
    return fallback;
  }
};

// Detecta a rota ativa inicial a partir da URL (path ou hash)
const getTabFromURL = (): string => {
  if (typeof window === 'undefined') return 'bi_comercial';
  const rawPath = window.location.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
  const rawHash = window.location.hash.replace(/^#\/?/, '').toLowerCase();
  const target = rawPath || rawHash;

  if (target === 'funil' || target === 'funil_vendas' || target === 'funil-vendas') return 'funil_vendas';
  if (target === 'vendas' || target === 'venda') return 'vendas';
  if (target === 'leads' || target === 'lead') return 'leads';
  if (target === 'bi' || target === 'bi_comercial' || target === 'comercial') return 'bi_comercial';
  if (target === 'dashboard' || target === 'painel') return 'dashboard';
  if (target === 'meu_dia' || target === 'meudia') return 'meu_dia';
  if (target === 'metas' || target === 'projetos') return 'metas';
  if (target === 'memoria' || target === 'cerebro') return 'memoria';
  if (target === 'revisao') return 'revisao';
  if (target === 'evolucao') return 'evolucao';
  if (target === 'entrevista') return 'entrevista';

  return 'bi_comercial';
};

export default function App() {
  // Local Storage State Persistent Hydration with automatic sanitization
  const [profile, setProfile] = useState<UserProfile>(() =>
    getSanitizedLocalStorage<UserProfile>('sb_profile', DEFAULT_USER_PROFILE)
  );

  const [memories, setMemories] = useState<MemoryItem[]>(() =>
    getSanitizedLocalStorage<MemoryItem[]>('sb_memories', [])
  );

  const [tasks, setTasks] = useState<TaskItem[]>(() =>
    getSanitizedLocalStorage<TaskItem[]>('sb_tasks', [])
  );

  const [goals, setGoals] = useState<GoalItem[]>(() =>
    getSanitizedLocalStorage<GoalItem[]>('sb_goals', [])
  );

  const [projects, setProjects] = useState<ProjectItem[]>(() =>
    getSanitizedLocalStorage<ProjectItem[]>('sb_projects', [])
  );

  const [reviews, setReviews] = useState<WeeklyReview[]>(() =>
    getSanitizedLocalStorage<WeeklyReview[]>('sb_reviews', [])
  );

  const [dailyHistory, setDailyHistory] = useState<DailyHistoryLog[]>(() =>
    getSanitizedLocalStorage<DailyHistoryLog[]>('sb_daily_history', [])
  );

  // Keep daily history updated with real current task counts for today
  useEffect(() => {
    const todayStr = getSaoPauloDateString();
    const dayName = getSaoPauloWeekday();
    const capitalizedDay = dayName.charAt(0).toUpperCase() + dayName.slice(1);

    const created = tasks.filter((task) => task.dataCriacao === todayStr).length;
    const concluidas = tasks.filter((task) => task.dataConclusao === todayStr).length;
    const tarefasPlanejadasHoje = tasks.filter((task) => task.data === todayStr && task.status !== 'cancelada');
    const pendentes = tarefasPlanejadasHoje.filter(
      (task) => !task.concluida && task.status !== 'concluida' && task.status !== 'adiada'
    ).length;
    const adiadas = tasks.filter((task) => task.dataCriacao === todayStr && task.status === 'adiada').length;
    const canceladas = tasks.filter((task) => task.dataCriacao === todayStr && task.status === 'cancelada').length;
    const concluidasPlanejadasHoje = tarefasPlanejadasHoje.filter(
      (task) => task.concluida || task.status === 'concluida'
    ).length;
    const percentualExecucao = tarefasPlanejadasHoje.length > 0
      ? Math.round((concluidasPlanejadasHoje / tarefasPlanejadasHoje.length) * 100)
      : 0;

    const todayLog: DailyHistoryLog = {
      data: todayStr,
      diaSemana: capitalizedDay,
      criadas: created,
      concluidas,
      pendentes,
      adiadas,
      canceladas,
      percentualExecucao,
    };

    setDailyHistory((prev) => {
      // Strip any old mock dates if any existed
      const realPrev = prev.filter((log) => log.data && !['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06'].includes(log.data));
      const exists = realPrev.some((log) => log.data === todayStr);
      let updated: DailyHistoryLog[];
      if (exists) {
        updated = realPrev.map((log) => (log.data === todayStr ? todayLog : log));
      } else {
        updated = [...realPrev, todayLog];
      }
      persistLocalState('sb_daily_history', updated);
      return updated;
    });
  }, [tasks]);

  // UI Navigation & Modals State
  const [activeTab, setActiveTab] = useState<string>(() => getTabFromURL());
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState<boolean>(false);
  const [isAIChatOpen, setIsAIChatOpen] = useState<boolean>(false);
  const [aiInitialPrompt, setAiInitialPrompt] = useState<string | undefined>(undefined);
  const [isQuickMemoryOpen, setIsQuickMemoryOpen] = useState<boolean>(false);
  const [isCloudSyncOpen, setIsCloudSyncOpen] = useState<boolean>(false);

  // Sincroniza abas com URL e histórico do navegador
  useEffect(() => {
    const handleUrlChange = () => {
      const detected = getTabFromURL();
      setActiveTab(detected);
    };

    window.addEventListener('popstate', handleUrlChange);
    window.addEventListener('hashchange', handleUrlChange);
    return () => {
      window.removeEventListener('popstate', handleUrlChange);
      window.removeEventListener('hashchange', handleUrlChange);
    };
  }, []);

  const handleTabChange = (newTab: string) => {
    setActiveTab(newTab);
    setIsMobileSidebarOpen(false);
    try {
      const path = newTab === 'bi_comercial' ? '/' : `/${newTab}`;
      if (window.location.pathname !== path) {
        window.history.pushState({ tab: newTab }, '', path);
      }
    } catch {
      // Ignora restrições do iframe se existirem
    }
  };

  // Commercial Data (Fase 3: Leads)
  const { leads } = useCommercialData();

  // Sync to localStorage
  useEffect(() => {
    persistLocalState('sb_profile', profile);
  }, [profile]);

  useEffect(() => {
    persistLocalState('sb_memories', memories);
  }, [memories]);

  useEffect(() => {
    persistLocalState('sb_tasks', tasks);
  }, [tasks]);

  useEffect(() => {
    persistLocalState('sb_goals', goals);
  }, [goals]);

  useEffect(() => {
    persistLocalState('sb_projects', projects);
  }, [projects]);

  useEffect(() => {
    persistLocalState('sb_reviews', reviews);
  }, [reviews]);

  // Inicia sincronização contínua apenas depois da hidratação local; a ativação exige migração manual.
  useEffect(() => initializeCloudSync(), []);

  // Handlers
  const handleCompleteInterview = (
    updatedProfile: UserProfile,
    aiGeneratedData?: {
      memories: any[];
      goals: any[];
      tasks: any[];
      welcomeAnalysis: string;
    }
  ) => {
    setProfile(updatedProfile);

    if (aiGeneratedData) {
      if (aiGeneratedData.memories && aiGeneratedData.memories.length > 0) {
        const newMems: MemoryItem[] = aiGeneratedData.memories.map((m: any, idx: number) => ({
          id: `mem-ai-${Date.now()}-${idx}`,
          categoria: (m.categoria as MemoryCategory) || 'identidade',
          titulo: m.titulo || 'Memória Registrada',
          conteudo: m.conteudo || '',
          importancia: (m.importancia as MemoryImportance) || 'alta',
          data: new Date().toISOString(),
          origin: 'interview',
        }));
        setMemories((prev) => {
          const existing = new Set(
            prev.map((memory) => `${memory.titulo.trim().toLocaleLowerCase()}|${memory.conteudo.trim().toLocaleLowerCase()}`)
          );
          const uniqueNewMemories = newMems.filter(
            (memory) => !existing.has(`${memory.titulo.trim().toLocaleLowerCase()}|${memory.conteudo.trim().toLocaleLowerCase()}`)
          );
          return [...uniqueNewMemories, ...prev];
        });
      }


    }

    setActiveTab('dashboard');
  };

  // Task Handlers
  const handleAddTask = (newTask: Omit<TaskItem, 'id' | 'data'> & { data?: string }) => {
    const item: TaskItem = {
      ...newTask,
      id: `task-${Date.now()}`,
      data: newTask.data || getSaoPauloDateString(),
      status: newTask.status || 'pendente',
      concluida: newTask.concluida || false,
      dataCriacao: getSaoPauloDateString(),
    };
    setTasks((prev) => [item, ...prev]);
  };

  const handleToggleTask = (id: string) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              concluida: !t.concluida,
              status: !t.concluida ? 'concluida' : 'pendente',
              dataConclusao: !t.concluida ? getSaoPauloDateString() : undefined,
            }
          : t
      )
    );
  };

  const handleUpdateTaskStatus = (searchTitleOrId: string, status: TaskStatus): boolean => {
    const query = searchTitleOrId?.trim().toLocaleLowerCase();
    if (!query) return false;

    const exact = tasks.find(
      (task) => task.id === searchTitleOrId || task.titulo.trim().toLocaleLowerCase() === query
    );
    const matches = tasks.filter(
      (task) => task.titulo.toLocaleLowerCase().includes(query) || query.includes(task.titulo.toLocaleLowerCase())
    );
    const target = exact || (matches.length === 1 ? matches[0] : undefined);
    if (!target) return false;

    setTasks((prev) =>
      prev.map((task) =>
        task.id === target.id
          ? {
              ...task,
              status,
              concluida: status === 'concluida',
              dataConclusao: status === 'concluida' ? getSaoPauloDateString() : task.dataConclusao,
            }
          : task
      )
    );
    return true;
  };

  const handleRescheduleTask = (searchTitleOrId: string, newDate: string): boolean => {
    const query = searchTitleOrId?.trim().toLocaleLowerCase();
    if (!query || !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return false;

    const exact = tasks.find(
      (task) => task.id === searchTitleOrId || task.titulo.trim().toLocaleLowerCase() === query
    );
    const matches = tasks.filter(
      (task) => task.titulo.toLocaleLowerCase().includes(query) || query.includes(task.titulo.toLocaleLowerCase())
    );
    const target = exact || (matches.length === 1 ? matches[0] : undefined);
    if (!target) return false;

    setTasks((prev) =>
      prev.map((task) => task.id === target.id ? { ...task, data: newDate, status: 'adiada' } : task)
    );
    return true;
  };

  const handleDeleteTask = (idOrTitle: string) => {
    setTasks((prev) => {
      const lower = idOrTitle.toLowerCase().trim();
      return prev.filter(
        (t) => t.id !== idOrTitle && !t.titulo.toLowerCase().includes(lower) && !lower.includes(t.titulo.toLowerCase())
      );
    });
  };

  const handleUpdateTaskPriority = (id: string, newPriority: TaskPriority) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, prioridade: newPriority } : t))
    );
  };

  // Goal Handlers
  const handleAddGoal = (newGoal: Omit<GoalItem, 'id' | 'dataCriacao'>) => {
    const item: GoalItem = {
      ...newGoal,
      id: `goal-${Date.now()}`,
      dataCriacao: getSaoPauloDateString(),
    };
    setGoals((prev) => [item, ...prev]);
  };

  const handleUpdateGoalProgress = (id: string, newProgress: number) => {
    setGoals((prev) =>
      prev.map((g) => (g.id === id ? { ...g, progresso: newProgress } : g))
    );
  };

  const handleToggleGoalNextStep = (goalId: string, stepIndex: number) => {
    setGoals((prev) =>
      prev.map((g) => {
        if (g.id !== goalId) return g;
        const updatedSteps = [...g.proximosPassos];
        // Toggle step with checkmark prefix if clicked
        if (updatedSteps[stepIndex].startsWith('✓ ')) {
          updatedSteps[stepIndex] = updatedSteps[stepIndex].replace('✓ ', '');
        } else {
          updatedSteps[stepIndex] = `✓ ${updatedSteps[stepIndex]}`;
        }
        return { ...g, proximosPassos: updatedSteps };
      })
    );
  };

  const handleDeleteGoal = (id: string) => {
    setGoals((prev) => prev.filter((g) => g.id !== id));
  };

  // Project Handlers
  const handleAddProject = (newProject: Omit<ProjectItem, 'id' | 'dataAtualizacao'>) => {
    const item: ProjectItem = {
      ...newProject,
      id: `proj-${Date.now()}`,
      dataAtualizacao: getSaoPauloDateString(),
    };
    setProjects((prev) => [item, ...prev]);
  };

  const handleUpdateProjectProgress = (id: string, newProgress: number) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, progresso: newProgress } : p))
    );
  };

  const handleDeleteProject = (id: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
  };

  // Memory Handlers
  const handleAddMemory = (newMem: Omit<MemoryItem, 'id' | 'data'>) => {
    const item: MemoryItem = {
      ...newMem,
      id: `mem-${Date.now()}`,
      data: new Date().toISOString(),
    };
    setMemories((prev) => [item, ...prev]);
  };

  const handleDeleteMemory = (id: string) => {
    setMemories((prev) => prev.filter((m) => m.id !== id));
  };

  // Weekly Review Handlers
  const handleSaveReview = (review: WeeklyReview) => {
    setReviews((prev) => [review, ...prev.filter((r) => r.id !== review.id)]);
  };

  const handleOpenAIChat = (prompt?: string) => {
    setAiInitialPrompt(prompt);
    setIsAIChatOpen(true);
  };

  return (
    <div className="min-h-screen font-sans flex flex-col bg-[#030712] text-slate-100 selection:bg-blue-900 selection:text-blue-100">
      {['bi_comercial', 'leads', 'funil_vendas', 'vendas'].includes(activeTab) ? (
        /* Layout Fullscreen Comercial com Sidebar Lateral e Suporte Mobile Completo */
        <div className="flex-1 flex flex-col lg:flex-row w-full min-h-screen bg-[#030712]">
          {/* Barra Superior para Mobile */}
          <div className="lg:hidden flex items-center justify-between px-4 py-3 bg-[#030712] border-b border-blue-950/80 sticky top-0 z-40">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsMobileSidebarOpen(true)}
                className="p-2 rounded-xl bg-blue-950/60 border border-blue-800/40 text-slate-300 hover:text-white transition-colors"
                title="Abrir Menu Lateral"
              >
                <Menu className="w-5 h-5 text-cyan-400" />
              </button>
              <div className="flex items-center tracking-wider text-xl font-black">
                <span className="text-white">RAX</span>
                <span className="text-cyan-400">XER</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] px-2.5 py-1 rounded-full bg-blue-950/80 border border-blue-800/60 text-cyan-300 font-semibold uppercase tracking-wide">
                {activeTab === 'funil_vendas'
                  ? 'Funil de Vendas'
                  : activeTab === 'vendas'
                  ? 'Vendas'
                  : activeTab === 'leads'
                  ? 'Leads'
                  : 'Dashboard'}
              </span>
              <button
                onClick={() => handleOpenAIChat()}
                className="p-2 rounded-xl bg-blue-600/20 border border-blue-500/40 text-cyan-400 hover:text-white transition-colors"
                title="RAXXER AI"
              >
                <Bot className="w-4 h-4" />
              </button>
            </div>
          </div>

          <Sidebar
            activeTab={activeTab}
            setActiveTab={handleTabChange}
            userName={profile.comoSerChamado || profile.nome || 'Wesley Alves'}
            onOpenAIChat={handleOpenAIChat}
            isOpenMobile={isMobileSidebarOpen}
            onCloseMobile={() => setIsMobileSidebarOpen(false)}
          />

          <main className="flex-1 overflow-x-hidden bg-[#070C1A] p-3 sm:p-4 lg:p-8">
            {activeTab === 'bi_comercial' ? (
              <CommercialBIDashboard
                userName={profile.comoSerChamado || profile.nome || 'Wesley'}
                onNavigate={handleTabChange}
                onOpenAIChat={handleOpenAIChat}
              />
            ) : activeTab === 'funil_vendas' ? (
              <SalesFunnelView
                onNavigate={handleTabChange}
                onOpenAIChat={handleOpenAIChat}
              />
            ) : activeTab === 'vendas' ? (
              <SalesView
                onNavigate={handleTabChange}
                onOpenAIChat={handleOpenAIChat}
              />
            ) : (
              <LeadsView />
            )}
          </main>
        </div>
      ) : (
        <>
          {/* Top Navigation para os outros módulos */}
          <Header
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            userName={profile.comoSerChamado || profile.nome}
            onOpenQuickMemoryModal={() => setIsQuickMemoryOpen(true)}
            onOpenAIChat={() => handleOpenAIChat()}
            onStartInterview={() => setActiveTab('entrevista')}
            memoriesCount={memories.length}
            leadsCount={leads.length}
          />

          {/* Main View Area */}
          <main className="flex-1 w-full mx-auto py-6 transition-all max-w-7xl px-4 lg:px-8">
            {activeTab === 'entrevista' ? (
              <InterviewWizard
                initialProfile={profile}
                onCompleteInterview={handleCompleteInterview}
                onCancel={() => setActiveTab('dashboard')}
              />
            ) : activeTab === 'meu_dia' ? (
              <MyDayView
                tasks={tasks}
                onAddTask={handleAddTask}
                onToggleTask={handleToggleTask}
                onDeleteTask={handleDeleteTask}
                onUpdateTaskPriority={handleUpdateTaskPriority}
                onOpenAIChat={handleOpenAIChat}
              />
            ) : activeTab === 'metas_projetos' ? (
              <GoalsProjectsView
                goals={goals}
                projects={projects}
                onAddGoal={handleAddGoal}
                onUpdateGoalProgress={handleUpdateGoalProgress}
                onToggleGoalNextStep={handleToggleGoalNextStep}
                onDeleteGoal={handleDeleteGoal}
                onAddProject={handleAddProject}
                onUpdateProjectProgress={handleUpdateProjectProgress}
                onDeleteProject={handleDeleteProject}
                onOpenAIChat={handleOpenAIChat}
              />
            ) : activeTab === 'leads' ? (
              <LeadsView />
            ) : activeTab === 'funil_vendas' ? (
              <SalesFunnelView
                onNavigate={setActiveTab}
                onOpenAIChat={handleOpenAIChat}
              />
            ) : activeTab === 'vendas' ? (
              <SalesView
                onNavigate={setActiveTab}
                onOpenAIChat={handleOpenAIChat}
              />
            ) : activeTab === 'memoria_viva' ? (
              <MemoryBrainView
                memories={memories}
                onAddMemory={handleAddMemory}
                onDeleteMemory={handleDeleteMemory}
              />
            ) : activeTab === 'revisao_semanal' ? (
              <WeeklyReviewView
                reviews={reviews}
                tasks={tasks}
                goals={goals}
                memories={memories}
                onSaveReview={handleSaveReview}
                onOpenAIChat={handleOpenAIChat}
              />
            ) : activeTab === 'evolucao' ? (
              <EvolutionView
                dailyHistory={dailyHistory}
                onOpenAIChat={handleOpenAIChat}
              />
            ) : (
              <DashboardView
                profile={profile}
                memories={memories}
                tasks={tasks}
                goals={goals}
                projects={projects}
                onNavigate={setActiveTab}
                onToggleTask={handleToggleTask}
                onAddTask={handleAddTask}
                onDeleteTask={handleDeleteTask}
                onOpenQuickMemory={() => setIsQuickMemoryOpen(true)}
                onOpenAIChat={handleOpenAIChat}
              />
            )}
          </main>
        </>
      )}

      {/* Acesso explícito à sincronização segura com D1 */}
      <button
        onClick={() => setIsCloudSyncOpen(true)}
        className="fixed bottom-4 right-4 z-[70] inline-flex items-center gap-2 rounded-full border border-cyan-500/40 bg-[#0B1730] px-4 py-3 text-sm font-semibold text-cyan-200 shadow-xl transition hover:border-cyan-300 hover:bg-[#102342]"
        title="Backup e sincronização dos dados"
        aria-label="Abrir backup e sincronização dos dados"
      >
        <Cloud className="h-4 w-4" />
        <span className="hidden sm:inline">Dados e backup</span>
      </button>
      {isCloudSyncOpen && <CloudSyncPanel onClose={() => setIsCloudSyncOpen(false)} />}

      {/* Persistent AI Chat Advisor Drawer */}
      <AIChatDrawer
        isOpen={isAIChatOpen}
        onClose={() => setIsAIChatOpen(false)}
        profile={profile}
        memories={memories}
        goals={goals}
        tasks={tasks}
        dailyHistory={dailyHistory}
        initialPrompt={aiInitialPrompt}
        onAddMemory={handleAddMemory}
        onAddTask={handleAddTask}
        onUpdateTaskStatus={handleUpdateTaskStatus}
        onRescheduleTask={handleRescheduleTask}
        onDeleteTask={handleDeleteTask}
        onAddGoal={handleAddGoal}
      />

      {/* Quick Memory Creator Modal */}
      <QuickMemoryModal
        isOpen={isQuickMemoryOpen}
        onClose={() => setIsQuickMemoryOpen(false)}
        onAddMemory={handleAddMemory}
      />
    </div>
  );
}
