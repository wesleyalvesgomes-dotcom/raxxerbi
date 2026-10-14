import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  X,
  Send,
  Brain,
  Bot,
  User,
  Zap,
  Target,
  AlertTriangle,
  Loader2,
  BookmarkPlus,
} from 'lucide-react';
import { AIChatMessage, DailyHistoryLog, GoalItem, MemoryItem, TaskItem, TaskPriority, TaskStatus, UserProfile } from '../types';
import { getSaoPauloDateString } from '../utils/date';

interface AIChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile;
  memories: MemoryItem[];
  goals: GoalItem[];
  tasks: TaskItem[];
  dailyHistory?: DailyHistoryLog[];
  initialPrompt?: string;
  onAddMemory: (memory: Omit<MemoryItem, 'id' | 'data'>) => void;
  onAddTask?: (task: Omit<TaskItem, 'id' | 'data'> & { data?: string }) => void;
  onUpdateTaskStatus?: (searchTitleOrId: string, status: TaskStatus) => boolean;
  onRescheduleTask?: (searchTitleOrId: string, newDate: string) => boolean;
  onDeleteTask?: (searchTitleOrId: string) => void;
  onAddGoal?: (goal: Omit<GoalItem, 'id' | 'dataCriacao'>) => void;
}

export const AIChatDrawer: React.FC<AIChatDrawerProps> = ({
  isOpen,
  onClose,
  profile,
  memories,
  goals,
  tasks,
  dailyHistory,
  initialPrompt,
  onAddMemory,
  onAddTask,
  onUpdateTaskStatus,
  onRescheduleTask,
  onDeleteTask,
  onAddGoal,
}) => {
  const [messages, setMessages] = useState<AIChatMessage[]>([
    {
      id: 'welcome-1',
      sender: 'ai',
      text: `Olá ${profile.comoSerChamado || profile.nome || 'Wesley'}! Sou seu Secretário Pessoal Inteligente. Como posso te ajudar agora? Pode me pedir para agendar compromissos, marcar tarefas como concluídas ou consultar seu histórico.`,
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      suggestedActions: [
        'Como está meu dia?',
        'Como foi minha semana?',
        'Raxxer, amanhã preciso pagar a conta de luz.',
        'Raxxer, já paguei a conta de luz.',
      ],
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialPrompt && isOpen) {
      handleSendMessage(initialPrompt);
    }
  }, [initialPrompt, isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!isOpen) return null;

  const handleSendMessage = async (textToSend?: string) => {
    const text = textToSend || inputText;
    if (!text.trim() || isLoading) return;

    const userMsg: AIChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: text.trim(),
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInputText('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text.trim(),
          profile,
          memories,
          goals,
          tasks,
          dailyHistory,
          chatHistory: messages.slice(-6).map((m) => ({
            role: m.sender === 'user' ? 'user' : 'assistant',
            text: m.text,
          })),
          context: {
            profile,
            memories,
            goals,
            tasks,
            dailyHistory,
          },
        }),
      });

      if (!response.ok) throw new Error('Falha no servidor');

      const data = await response.json();

      // Executar ações de mutação retornadas pela IA
      let actionWarning: string | null = null;
      if (data.actions && Array.isArray(data.actions)) {
        data.actions.forEach((act: any) => {
          switch (act.type) {
            case 'add_memory':
              if (typeof act.titulo !== 'string' || !act.titulo.trim() || typeof act.conteudo !== 'string' || !act.conteudo.trim()) break;
              onAddMemory({
                categoria: act.categoria || 'identidade',
                titulo: act.titulo,
                conteudo: act.conteudo,
                importancia: act.importancia || 'alta',
                origin: 'auto_extracted',
              });
              break;

            case 'add_task':
              if (onAddTask && typeof act.titulo === 'string' && act.titulo.trim()) {
                onAddTask({
                  titulo: act.titulo || 'Nova Tarefa',
                  descricao: act.descricao || '',
                  prioridade: (act.prioridade as TaskPriority) || 'media',
                  horario: act.horarioSugerido,
                  dataCriacao: getSaoPauloDateString(),
                  concluida: false,
                  status: 'pendente',
                  data: act.data,
                });
              }
              break;

            case 'update_task_status':
              if (
                onUpdateTaskStatus &&
                typeof act.searchTitleOrId === 'string' && act.searchTitleOrId.trim() &&
                ['pendente', 'em_andamento', 'concluida', 'adiada', 'cancelada'].includes(act.status)
              ) {
                const applied = onUpdateTaskStatus(act.searchTitleOrId, act.status);
                if (!applied) actionWarning = 'Não alterei a tarefa: não encontrei um único registro correspondente. Informe o título exato.';
              }
              break;

            case 'reschedule_task':
              if (
                onRescheduleTask &&
                typeof act.searchTitleOrId === 'string' && act.searchTitleOrId.trim() &&
                typeof act.newDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(act.newDate)
              ) {
                const applied = onRescheduleTask(act.searchTitleOrId, act.newDate);
                if (!applied) actionWarning = 'Não reagendei a tarefa: não encontrei um único registro correspondente. Informe o título exato.';
              }
              break;

            case 'delete_task':
              // Ações da IA nunca apagam registros permanentemente.
              break;

            case 'add_goal':
              if (onAddGoal && typeof act.titulo === 'string' && act.titulo.trim()) {
                onAddGoal({
                  titulo: act.titulo || 'Nova Meta',
                  descricao: act.descricao || '',
                  area: act.area || 'profissional',
                  prazo: act.prazo || '',
                  progresso: 0,
                  status: 'em_andamento',
                });
              }
              break;

            default:
              break;
          }
        });
      }

      const aiMsg: AIChatMessage = {
        id: `ai-${Date.now()}`,
        sender: 'ai',
        text: actionWarning || data.text || 'Anotei.',
        timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, aiMsg]);
    } catch (err: any) {
      console.error('RAXXER Chat Error:', err);
      const errorDetail = err?.message || 'Falha de comunicação.';
      setMessages((prev) => [
        ...prev,
        {
          id: `ai-err-${Date.now()}`,
          sender: 'ai',
          text: `Não consegui conectar à inteligência do RAXXER. Verifique a configuração da GEMINI_API_KEY.\n\nDetalhes do erro: ${errorDetail}`,
          timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/75 backdrop-blur-sm transition-all animate-fadeIn font-sans">
      <div className="w-full max-w-lg bg-[#070D1E] border-l border-blue-900/50 h-full flex flex-col shadow-2xl relative text-slate-100">
        {/* Header */}
        <div className="p-4 border-b border-blue-900/40 flex items-center justify-between bg-[#081126]">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-950/80 border border-blue-500/40 flex items-center justify-center text-cyan-400 shadow-[0_0_12px_rgba(56,189,248,0.2)]">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight">Secretário RAXXER</h3>
              <p className="text-[11px] text-cyan-400 font-medium">Seu Secretário Pessoal Inteligente</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Prompts Chip Bar */}
        <div className="p-3 bg-[#060B19] border-b border-blue-900/40 flex items-center gap-2 overflow-x-auto no-scrollbar">
          <button
            onClick={() => handleSendMessage('Qual é a coisa mais importante que preciso fazer hoje?')}
            className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-[#0B1530] text-slate-300 border border-blue-900/50 hover:text-cyan-300 hover:border-blue-500/50 whitespace-nowrap transition-colors flex items-center gap-1 cursor-pointer"
          >
            <Zap className="w-3 h-3 text-amber-400" />
            Prioridade de Hoje
          </button>
          <button
            onClick={() => handleSendMessage('Analise se estou no caminho certo das minhas metas.')}
            className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-[#0B1530] text-slate-300 border border-blue-900/50 hover:text-cyan-300 hover:border-blue-500/50 whitespace-nowrap transition-colors flex items-center gap-1 cursor-pointer"
          >
            <Target className="w-3 h-3 text-emerald-400" />
            Análise de Metas
          </button>
          <button
            onClick={() => handleSendMessage('Onde você identifica que posso estar procrastinando?')}
            className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-[#0B1530] text-slate-300 border border-blue-900/50 hover:text-cyan-300 hover:border-blue-500/50 whitespace-nowrap transition-colors flex items-center gap-1 cursor-pointer"
          >
            <AlertTriangle className="w-3 h-3 text-amber-400" />
            Procrastinação
          </button>
        </div>

        {/* Messages List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#050A18]/60">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.sender === 'ai' && (
                <div className="w-7 h-7 rounded-lg bg-blue-950/80 border border-blue-600/40 flex items-center justify-center text-cyan-400 shrink-0 mt-1">
                  <Brain className="w-4 h-4" />
                </div>
              )}

              <div
                className={`max-w-[85%] rounded-2xl p-3.5 text-xs md:text-sm leading-relaxed ${
                  msg.sender === 'user'
                    ? 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow-[0_0_15px_rgba(37,99,235,0.3)] font-medium'
                    : 'bg-[#09132C] border border-blue-900/50 text-slate-200 shadow-md'
                }`}
              >
                <div className="whitespace-pre-line font-light">{msg.text}</div>

                <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                  <span>{msg.timestamp}</span>
                </div>

                {/* Suggested Action Chips */}
                {msg.suggestedActions && msg.suggestedActions.length > 0 && (
                  <div className="mt-3 pt-2 border-t border-blue-900/30 flex flex-wrap gap-1.5">
                    {msg.suggestedActions.map((act, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleSendMessage(act)}
                        className="px-2.5 py-1 rounded-lg bg-[#070D1E] hover:bg-blue-950/80 border border-blue-900/40 text-[11px] font-medium text-cyan-300 hover:border-blue-500/50 transition-colors cursor-pointer"
                      >
                        {act}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {msg.sender === 'user' && (
                <div className="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 shrink-0 mt-1">
                  <User className="w-4 h-4" />
                </div>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="flex items-center gap-2 text-xs text-cyan-400 font-medium p-2 font-mono">
              <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
              <span>O RAXXER está analisando...</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Chat Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="p-3 border-t border-blue-900/40 bg-[#081126] flex items-center gap-2"
        >
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Fale com seu Secretário RAXXER..."
            disabled={isLoading}
            className="flex-1 px-4 py-2.5 rounded-xl bg-[#050A18] border border-blue-900/50 text-white text-xs placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={isLoading || !inputText.trim()}
            className="p-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white disabled:opacity-40 transition-all shadow-[0_0_12px_rgba(56,189,248,0.25)] cursor-pointer"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
