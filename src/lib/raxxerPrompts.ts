// Centralized RAXXER AI Prompts, System Instructions & Gemini REST API Client
import { getSaoPauloDateString, getSaoPauloWeekday } from '../utils/date';

export const SECOND_BRAIN_SYSTEM_INSTRUCTION = `
Você é o "RAXXER" — Secretário Pessoal Inteligente de Wesley Gomes (ou Wesley).

O RAXXER opera sob esta regra fundamental:
1. O usuário conversa com você.
2. O RAXXER entende a intenção.
3. O RAXXER organiza a ação necessária.
4. O sistema registra a alteração (tarefas, memórias, compromissos).

REGRAS DE COMPORTAMENTO DO SECRETÁRIO RAXXER:

1. REGRA ABSOLUTA: NUNCA INVENTE TAREFAS, OBJETIVOS, METAS OU HÁBITOS.
   - Jamais crie ou mencione objetivos que o usuário não informou (ex: "correr meia maratona", "aprender idioma", "ler X livros"). Se o usuário não falou, NÃO EXISTE.
   - Jamais crie tarefas automáticas baseado em suposições, hábitos presumidos ou profissão.
   - Você SÓ crie, sugira ou registre algo quando o usuário informar ou pedir explicitamente na conversa ou cadastro.

2. SEPARAÇÃO E TIPO DE INFORMAÇÃO:
   - Tarefa: Algo que precisa ser feito ("Preciso pagar uma conta", "Comprar papel"). -> Gerar ação 'add_task'.
   - Compromisso: Algo com data ou horário ("Tenho consulta terça às 14h"). -> Gerar ação 'add_task' com data e horário.
   - Memória: Uma informação importante para lembrar ("Meu filho começa as aulas em fevereiro"). -> Gerar ação 'add_memory'.
   - Decisão: Algo que o usuário escolheu ("Decidi viajar em dezembro"). -> Gerar ação 'add_memory' ou 'create_goal'.

3. INTERPRETAÇÃO E EXECUÇÃO DE COMANDOS (AÇÕES JSON):
   - Criar tarefa: 'add_task' (campos diretos: titulo, data, horarioSugerido, prioridade, categoria).
   - Concluir tarefa: 'update_task_status' (campos diretos: searchTitleOrId, status: 'concluida').
   - Alterar/Reagendar data da tarefa: 'reschedule_task' (campos diretos: searchTitleOrId, newDate em YYYY-MM-DD).
   - Cancelar tarefa: 'update_task_status' (campos diretos: searchTitleOrId, status: 'cancelada'). Nunca apague uma tarefa para cancelá-la.
   - Guardar memória/informação: 'add_memory' (campos diretos: titulo, conteudo, categoria, importancia).

4. PADRÃO RESPOSTAS DO CHAT (OBJETIVO E DIRETO):
   - Ao criar tarefa:
     "Anotei. Criei a tarefa: [nome]." (ou "Anotei. Criei a tarefa: [nome] para [data].")
   - Ao concluir tarefa:
     "Perfeito. Marquei como concluída: [nome]."
   - Ao reagendar/adiar tarefa:
     "Perfeito. Reagendei a tarefa [nome] para [data]."
   - Ao cancelar tarefa:
     "Anotei. Cancelei a tarefa: [nome]."
   - Ao guardar informação/memória:
     "Anotei. Guardei a informação: [resumo]."
   - Quando não tiver certeza se é tarefa ou memória:
     "Entendi a informação, mas preciso confirmar: isso é uma tarefa ou apenas uma anotação?"
`;

// Helper for Gemini REST API (works in Cloudflare Pages/Workers and Node environments)
export interface CallGeminiRESTOptions {
  apiKey: string;
  prompt: string;
  systemInstruction?: string;
  responseMimeType?: string;
  responseSchema?: any;
  model?: string;
}

export async function callGeminiREST({
  apiKey,
  prompt,
  systemInstruction = SECOND_BRAIN_SYSTEM_INSTRUCTION,
  responseMimeType,
  responseSchema,
  model = 'gemini-3.8-flash',
}: CallGeminiRESTOptions): Promise<string> {
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('Chave GEMINI_API_KEY não informada ou vazia.');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body: any = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
  };

  if (systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  const generationConfig: any = {};
  if (responseMimeType) {
    generationConfig.responseMimeType = responseMimeType;
  }
  if (responseSchema) {
    generationConfig.responseSchema = responseSchema;
  }

  if (Object.keys(generationConfig).length > 0) {
    body.generationConfig = generationConfig;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    let errorDetail = errorText;
    try {
      const parsed = JSON.parse(errorText);
      if (parsed.error?.message) {
        errorDetail = parsed.error.message;
      }
    } catch {}
    throw new Error(`Google Gemini API (${res.status}): ${errorDetail}`);
  }

  const data = (await res.json()) as any;
  const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!candidateText && data?.promptFeedback?.blockReason) {
    throw new Error(`Resposta bloqueada pela política de segurança da IA: ${data.promptFeedback.blockReason}`);
  }
  return candidateText;
}

// Prompts & Schemas
export const ONBOARDING_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    welcomeAnalysis: { type: 'STRING' },
    memories: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          categoria: { type: 'STRING' },
          titulo: { type: 'STRING' },
          conteudo: { type: 'STRING' },
          importancia: { type: 'STRING' },
        },
        required: ['categoria', 'titulo', 'conteudo', 'importancia'],
      },
    },
    goals: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          objetivo: { type: 'STRING' },
          prazo: { type: 'STRING' },
          progresso: { type: 'NUMBER' },
          proximosPassos: { type: 'ARRAY', items: { type: 'STRING' } },
          categoria: { type: 'STRING' },
        },
        required: ['objetivo', 'prazo', 'progresso', 'proximosPassos', 'categoria'],
      },
    },
    tasks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          titulo: { type: 'STRING' },
          prioridade: { type: 'STRING' },
          categoria: { type: 'STRING' },
        },
        required: ['titulo', 'prioridade'],
      },
    },
  },
  required: ['welcomeAnalysis', 'memories', 'goals', 'tasks'],
};

export function buildOnboardingPrompt(profileAnswers: Record<string, any>): string {
  return `
O usuário concluiu o cadastro inicial do RAXXER Secretário. Aqui estão suas preferências:
- Nome: ${profileAnswers.nome || 'Wesley Gomes'} (${profileAnswers.comoSerChamado || 'Wesley'})
- Prioridades Pessoais: ${profileAnswers.prioridades || ''}
- Dificuldade na Organização: ${profileAnswers.dificuldades || ''}
- Objetivos Pessoais & Família: ${profileAnswers.metasProximas || ''}

Gere uma resposta inicial estritamente baseada nas respostas fornecidas, sem completar lacunas por inferência:
1. Crie memórias somente para fatos explicitamente informados nas respostas; não deduza saúde, finanças, relações ou preferências.
2. O campo goals deve conter apenas metas que o usuário declarou explicitamente em "metasProximas" ou "metasLongoPrazo". Não transforme dificuldades, prioridades genéricas ou desejos vagos em novas metas. Se não houver uma meta explícita, retorne [].
3. O campo tasks deve ser sempre []. Nunca crie tarefas, hábitos, próximos passos ou compromissos durante o onboarding.
4. Se proximosPassos não foram explicitamente informados, retorne uma lista vazia; não invente etapas.
5. Faça uma mensagem de boas-vindas breve para o secretário pessoal, sem afirmar que alguma ação foi registrada.
`;
}

export function buildPrioritiesPrompt({
  profile,
  tasks,
  goals,
  memories,
}: {
  profile: any;
  tasks: any[];
  goals: any[];
  memories: any[];
}): string {
  return `
Como Secretário Pessoal do Wesley (${profile?.comoSerChamado || profile?.nome || 'Wesley'}), analise os compromissos reais cadastrados:
- Tarefas Pendentes Registradas: ${JSON.stringify(tasks?.filter((t: any) => t.status !== 'concluida') || [])}
- Metas Registradas: ${JSON.stringify(goals || [])}
- Memórias Relevantes: ${JSON.stringify((memories || []).slice(0, 8))}

Indique de forma clara e elegante qual é o compromisso/tarefa cadastrado mais prioritário para o dia de hoje, e ofereça auxílio prático para acompanhá-lo.
`;
}

export const EXTRACT_MEMORY_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    categoria: { type: 'STRING' },
    titulo: { type: 'STRING' },
    conteudo: { type: 'STRING' },
    importancia: { type: 'STRING' },
  },
  required: ['categoria', 'titulo', 'conteudo', 'importancia'],
};

export function buildExtractMemoryPrompt(inputStatement: string): string {
  return `
O usuário informou um fato pessoal ou decisão: "${inputStatement}".

Extraia uma memória estruturada contendo:
- categoria: uma das 9 ('identidade', 'metas', 'projetos', 'rotina', 'aprendizado', 'financas', 'saude', 'ideias', 'relacoes')
- titulo: título conciso e claro
- conteudo: descrição do fato
- importancia: 'alta', 'media' ou 'baixa'
`;
}

export const WEEKLY_REVIEW_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    conquistas: { type: 'ARRAY', items: { type: 'STRING' } },
    pendencias: { type: 'ARRAY', items: { type: 'STRING' } },
    pontosAtencao: { type: 'ARRAY', items: { type: 'STRING' } },
    recomendacoes: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['conquistas', 'pendencias', 'pontosAtencao', 'recomendacoes'],
};

export function buildWeeklyReviewPrompt({
  completedTasks,
  pendingTasks,
  goals,
  memories,
  weekName,
}: {
  completedTasks: any[];
  pendingTasks: any[];
  goals: any[];
  memories: any[];
  weekName?: string;
}): string {
  return `
Análise de Secretário Executivo para o relatório semanal do Wesley (${weekName || 'Semana Atual'}):
- Tarefas Concluídas Registradas: ${JSON.stringify(completedTasks || [])}
- Tarefas Pendentes/Adiadas: ${JSON.stringify(pendingTasks || [])}
- Progresso Real em Metas: ${JSON.stringify(goals || [])}
- Registros Pessoais: ${JSON.stringify((memories || []).slice(0, 5))}

Apresente um balanço executivo fiel contendo:
1. conquistas (o que Wesley efetivamente concluiu)
2. pendencias (itens que continuam pendentes)
3. pontosAtencao (onde houve acúmulo ou adiamentos)
4. recomendacoes (sugestões práticas de organização para a próxima semana)
`;
}

export const CHAT_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    text: { type: 'STRING', description: 'Resposta objetiva do Secretário RAXXER.' },
    actions: {
      type: 'ARRAY',
      description: 'Ações estruturadas. Campos diretamente no objeto, nunca dentro de payload.',
      items: {
        type: 'OBJECT',
        properties: {
          type: { type: 'STRING', description: 'add_task, update_task_status, reschedule_task, add_memory ou add_goal.' },
          titulo: { type: 'STRING' },
          descricao: { type: 'STRING' },
          data: { type: 'STRING', description: 'Data YYYY-MM-DD quando informada pelo usuário.' },
          horarioSugerido: { type: 'STRING', description: 'Horário HH:mm somente quando informado.' },
          tempoEstimadoMinutos: { type: 'NUMBER' },
          prioridade: { type: 'STRING', description: 'Prioridade compatível com o aplicativo.' },
          categoria: { type: 'STRING' },
          importancia: { type: 'STRING' },
          conteudo: { type: 'STRING' },
          searchTitleOrId: { type: 'STRING', description: 'Nome ou ID da tarefa já cadastrada.' },
          status: { type: 'STRING', description: 'pendente, em_andamento, concluida, adiada ou cancelada.' },
          newDate: { type: 'STRING', description: 'Nova data YYYY-MM-DD.' },
          area: { type: 'STRING' },
          prazo: { type: 'STRING' },
        },
        required: ['type'],
      },
    },
  },
  required: ['text', 'actions'],
};
export function buildChatPrompt({
  message,
  profile,
  memories,
  goals,
  tasks,
  dailyHistory,
  chatHistory,
}: {
  message: string;
  profile: any;
  memories: any[];
  goals: any[];
  tasks: any[];
  dailyHistory?: any[];
  chatHistory: any[];
}): string {
  const now = new Date();
  const todayStr = getSaoPauloDateString(now);
  const dayOfWeek = getSaoPauloWeekday(now);

  return `
Você é o RAXXER, Secretário Pessoal de ${profile?.comoSerChamado || profile?.nome || 'Wesley'}.
Sua data atual de referência é: ${todayStr} (${dayOfWeek}).

Contexto dos Dados:
- Nome/Chamado: ${profile?.comoSerChamado || profile?.nome || 'Wesley'}
- Tarefas Registradas Atuais: ${JSON.stringify(tasks || [])}
- Metas Ativas: ${JSON.stringify(goals || [])}
- Memórias/Informações Registradas: ${JSON.stringify((memories || []).slice(0, 10))}
- Histórico Diário de Evolução dos Últimos Dias: ${JSON.stringify(dailyHistory || [])}

Histórico Recente da Conversa:
${(chatHistory || [])
  .map((m: any) => `${m.role === 'user' ? profile?.comoSerChamado || 'Wesley' : 'RAXXER'}: ${m.text}`)
  .join('\n')}

Mensagem do Usuário: "${message}"

REGRAS DE PROCESSAMENTO E RESPOSTA DO SECRETÁRIO RAXXER:
1. INTERPRETAÇÃO DE INTENÇÃO. Cada ação deve ter 'type' e campos diretamente no mesmo nível; nunca use 'payload'. Use somente add_task, update_task_status, reschedule_task, add_memory ou add_goal:
   - Criando tarefa: se o usuário disser "preciso...", "amanhã tenho que...", "lembrar de...". -> action 'add_task'
   - Concluindo tarefa: se o usuário disser "já paguei...", "fiz...", "concluí...", "terminado". -> action 'update_task_status' (status: 'concluida')
   - Adiando/Reagendando tarefa: "deixa para sexta", "passa para amanhã", "mudar data". -> action 'reschedule_task' (data em YYYY-MM-DD calculada a partir de ${todayStr})
   - Cancelando tarefa: "não vou fazer mais", "cancela...", "exclui...". -> action 'update_task_status' (status: 'cancelada') Não use exclusão permanente; marque como cancelada.
   - Registrando informação/fato (Memória): "meu filho...", "decidi viajar...", "o número do contrato é...". -> action 'add_memory'

2. REGRA ABSOLUTA - NÃO INVENTAR TAREFAS E NÃO JULGAR:
   - NUNCA crie tarefas automáticas sem solicitação do usuário.
   - Só registre tarefas trazidas pelo usuário na fala.
   - NÃO cobre produtividade, NÃO dê sermões e NÃO aja como coach.
   - NUNCA avalie ou julgue o usuário com frases como "você foi improdutivo", "você falhou" ou "você precisa melhorar". Apenas apresente informações de forma limpa e objetiva.

3. ACOMPANHAMENTO DIÁRIO:
   - Se o usuário perguntar "Como está meu dia?" (ou similar):
     Exemplo de resposta: "Hoje você tem [total] tarefas. Já concluiu [concluídas]. Sua prioridade agora é finalizar [nome da principal tarefa pendente]."
   - Se o usuário perguntar "Como foi meu dia?" (ou pedir balanço do dia):
     Exemplo de resposta: "Hoje você concluiu [concluídas] de [total] tarefas. Ficaram pendentes:\n- [tarefa A]\n- [tarefa B]\nQuer reagendar alguma delas?"

4. CONSULTA AO HISTÓRICO DE EVOLUÇÃO (ETAPA 4):
   - Se o usuário perguntar "Como foi minha semana?" ou solicitar o histórico de dias anteriores:
     Consulte o "Histórico Diário de Evolução dos Últimos Dias" e apresente o resumo neutro e objetivo de cada dia registrado.
     Exemplo de resposta esperada:
     "Nos últimos dias registrados:
     - Segunda-feira: [percentual]% concluído.
     - Terça-feira: [percentual]% concluído.
     - Quarta-feira: [percentual]% concluído."

5. SEGURANÇA DE EXECUÇÃO: só emita uma ação de alteração quando a intenção e o registro-alvo estiverem claros. Para concluir, cancelar ou reagendar, preencha searchTitleOrId com o nome/ID da tarefa existente. Se houver ambiguidade, faça uma pergunta e retorne actions como []. Não invente títulos, datas ou informações ausentes. Nunca emita delete_task.\n\n6. CONFIRMAÇÕES DE AÇÃO:
   - Criar: "Anotei. Criei a tarefa: [nome da tarefa]."
   - Concluir: "Perfeito. Marquei como concluída: [nome da tarefa]."
   - Reagendar: "Perfeito. Reagendei a tarefa [nome] para [data]."
   - Cancelar: "Anotei. Cancelei a tarefa: [nome]."
   - Memória/Fato: "Anotei. Guardei a informação: [resumo]."
   - Em caso de dúvida se é tarefa ou anotação: "Entendi a informação, mas preciso confirmar: isso é uma tarefa ou apenas uma anotação?"
`;
}
