export interface DailyHistoryLog {
  data: string; // YYYY-MM-DD
  diaSemana: string;
  criadas: number;
  concluidas: number;
  pendentes: number;
  adiadas: number;
  canceladas: number;
  percentualExecucao: number;
}

export type MemoryCategory =
  | 'identidade'
  | 'metas'
  | 'projetos'
  | 'rotina'
  | 'aprendizado'
  | 'financas'
  | 'saude'
  | 'ideias'
  | 'relacoes';

export type MemoryImportance = 'alta' | 'media' | 'baixa';

export interface MemoryItem {
  id: string;
  categoria: MemoryCategory;
  titulo: string;
  conteudo: string;
  importancia: MemoryImportance;
  data: string;
  editavel?: boolean;
  origin?: 'interview' | 'auto_extracted' | 'manual';
}

export type TaskPriority = 'alta' | 'media' | 'baixa' | 'urgente' | 'importante' | 'pode_esperar';
export type TaskStatus = 'pendente' | 'em_andamento' | 'concluida' | 'adiada' | 'cancelada';

export interface TaskItem {
  id: string;
  titulo: string;
  descricao?: string;
  prioridade: TaskPriority;
  status: TaskStatus;
  concluida: boolean;
  data: string; // YYYY-MM-DD
  horario?: string; // HH:mm
  categoria?: string;
  projetoRelacionado?: string;
  dataCriacao: string;
  dataConclusao?: string;
  observacoes?: string;
  notas?: string;
}

export interface GoalItem {
  id: string;
  objetivo: string;
  prazo: string;
  progresso: number; // 0 to 100
  proximosPassos: string[];
  categoria: MemoryCategory;
  dataCriacao: string;
  status: 'em_andamento' | 'concluido' | 'em_espera';
}

export interface ProjectItem {
  id: string;
  nome: string;
  descricao: string;
  prioridade: MemoryImportance;
  progresso: number; // 0 to 100
  status: 'ativo' | 'planejamento' | 'concluido';
  tarefasRelacionadas?: string[];
  dataAtualizacao: string;
}

export interface WeeklyReview {
  id: string;
  semana: string;
  conquistas: string[];
  pendencias: string[];
  pontosAtencao: string[];
  recomendacoes: string[];
  data: string;
}

export interface UserProfile {
  nome: string;
  comoSerChamado: string;
  rotinaAtual: string;
  responsabilidades: string;
  metasProximas: string;
  metasLongoPrazo: string;
  mudancasDesejadas: string;
  projetosAtuais: string;
  ideiasFuturas: string;
  prioridades: string;
  organizacaoHoje: string;
  dificuldades: string;
  procrastination: string;
  estudando: string;
  querAprender: string;
  rotinaSaude: string;
  habitosMelhorar: string;
  objetivosFinanceiros: string;
  planejamentoFinancas: string;
  interviewCompleted: boolean;
  currentInterviewStep: number;
}

export type AIChatActionType =
  | 'add_task'
  | 'update_task_status'
  | 'reschedule_task'
  | 'add_goal'
  | 'add_memory';

export interface AIChatAction {
  type: AIChatActionType;
  titulo?: string;
  descricao?: string;
  data?: string;
  horarioSugerido?: string;
  tempoEstimadoMinutos?: number;
  prioridade?: TaskPriority;
  categoria?: MemoryCategory | string;
  importancia?: MemoryImportance;
  conteudo?: string;
  searchTitleOrId?: string;
  status?: TaskStatus;
  newDate?: string;
  area?: string;
  prazo?: string;
}

export interface AIChatMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  timestamp: string;
  actions?: AIChatAction[];
  suggestedActions?: string[];
  extractedMemories?: Partial<MemoryItem>[];
}

export const CATEGORY_DETAILS: Record<
  MemoryCategory,
  { label: string; icon: string; color: string; bgColor: string; borderColor: string }
> = {
  identidade: {
    label: 'Identidade',
    icon: 'Brain',
    color: 'text-purple-400',
    bgColor: 'bg-purple-950/40',
    borderColor: 'border-purple-800/50',
  },
  metas: {
    label: 'Metas',
    icon: 'Target',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-950/40',
    borderColor: 'border-emerald-800/50',
  },
  projetos: {
    label: 'Projetos',
    icon: 'FolderKanban',
    color: 'text-blue-400',
    bgColor: 'bg-blue-950/40',
    borderColor: 'border-blue-800/50',
  },
  rotina: {
    label: 'Rotina',
    icon: 'Calendar',
    color: 'text-amber-400',
    bgColor: 'bg-amber-950/40',
    borderColor: 'border-amber-800/50',
  },
  aprendizado: {
    label: 'Aprendizado',
    icon: 'BookOpen',
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-950/40',
    borderColor: 'border-cyan-800/50',
  },
  financas: {
    label: 'Finanças',
    icon: 'Coins',
    color: 'text-green-400',
    bgColor: 'bg-green-950/40',
    borderColor: 'border-green-800/50',
  },
  saude: {
    label: 'Saúde',
    icon: 'Heart',
    color: 'text-rose-400',
    bgColor: 'bg-rose-950/40',
    borderColor: 'border-rose-800/50',
  },
  ideias: {
    label: 'Ideias',
    icon: 'Lightbulb',
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-950/40',
    borderColor: 'border-yellow-800/50',
  },
  relacoes: {
    label: 'Relações',
    icon: 'Users',
    color: 'text-pink-400',
    bgColor: 'bg-pink-950/40',
    borderColor: 'border-pink-800/50',
  },
};

// Re-exportação dos tipos do BI Comercial (Fase 2)
export * from './types/commercial';
