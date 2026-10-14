// Serviço de Persistência Local para o Controle Comercial e BI do RAXXER
// Escopo oficial: 7 Status, Cadastro rápido, Histórico de Eventos e Balanços (Diário, Semanal e Mensal)

import {
  CommercialDataSnapshot,
  CommercialFunnelStage,
  CommercialGoalItem,
  CommercialInteractionItem,
  CommercialLeadHistoryEvent,
  CommercialLeadItem,
  CommercialLeadStatus,
  CommercialProposalItem,
  CommercialSaleItem,
  CommercialVisitItem,
  LeadHistoryEventType,
  ProposalStatus,
  SaleStatus,
  VisitStatus,
} from '../types/commercial';
import {
  INITIAL_COMMERCIAL_LEADS,
  INITIAL_COMMERCIAL_GOALS,
} from '../utils/initialCommercialData';

// Chaves exclusivas e isoladas no localStorage para o BI Comercial
export const COMMERCIAL_STORAGE_KEYS = {
  LEADS: 'raxxer_com_leads',
  LEAD_HISTORY: 'raxxer_com_lead_history',
  INTERACTIONS: 'raxxer_com_interactions',
  VISITS: 'raxxer_com_visits',
  PROPOSALS: 'raxxer_com_proposals',
  SALES: 'raxxer_com_sales',
  GOALS: 'raxxer_com_goals',
} as const;

// Nome do evento para reatividade entre componentes
export const COMMERCIAL_UPDATE_EVENT = 'raxxer_commercial_storage_update';

// Helpers seguros de acesso ao localStorage
function readFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback;
  }
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch (err) {
    console.error(`[commercialStorage] Erro ao ler chave "${key}":`, err);
    return fallback;
  }
}

function writeToStorage<T>(key: string, data: T): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    localStorage.setItem(key, JSON.stringify(data));
    window.dispatchEvent(
      new CustomEvent(COMMERCIAL_UPDATE_EVENT, { detail: { key, timestamp: Date.now() } })
    );
  } catch (err) {
    console.error(`[commercialStorage] Erro ao gravar chave "${key}":`, err);
  }
}

// Normalizador seguro de status antigo para as 7 situações oficiais
export function normalizeLeadStatus(rawStatus?: string): CommercialLeadStatus {
  if (!rawStatus) return 'atendimentos';

  const s = rawStatus.toLowerCase().trim();

  // 1. Atendimentos
  if (
    s === 'atendimentos' ||
    s === 'atendimento' ||
    s === 'novo_lead' ||
    s === 'primeira_tratativa' ||
    s === 'segunda_tratativa' ||
    s === 'terceira_tratativa' ||
    s === 'visita_agendada' ||
    s === 'proposta' ||
    s === 'ativo'
  ) {
    return 'atendimentos';
  }

  // 2. Descartados
  if (s === 'descartados' || s === 'descartado' || s === 'perdido' || s === 'arquivado') {
    return 'descartados';
  }

  // 3. Não atenderam
  if (s === 'nao_atenderam' || s === 'nao_atendeu' || s === 'sem_retorno') {
    return 'nao_atenderam';
  }

  // 4. Em análise
  if (s === 'em_analise' || s === 'analise' || s === 'documentacao') {
    return 'em_analise';
  }

  // 5. Aprovados
  if (s === 'aprovados' || s === 'aprovado' || s === 'credito_aprovado') {
    return 'aprovados';
  }

  // 6. Reprovados
  if (s === 'reprovados' || s === 'reprovado' || s === 'credito_reprovado') {
    return 'reprovados';
  }

  // 7. Vendidos
  if (s === 'vendidos' || s === 'vendido' || s === 'venda' || s === 'fechado' || s === 'ganho') {
    return 'vendidos';
  }

  return 'atendimentos';
}

function normalizeLead(raw: any): CommercialLeadItem {
  const normalizedStatus = normalizeLeadStatus(raw.status || raw.etapa);
  const now = new Date().toISOString();

  // Valores legados
  const valorEst = typeof raw.valorEstimado === 'number' ? raw.valorEstimado : undefined;
  const vgv = typeof raw.vgv === 'number' ? raw.vgv : valorEst;

  return {
    ...raw,
    id: raw.id || `lead-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    nome: raw.nome || 'Lead sem nome',
    telefone: raw.telefone || '',
    whatsapp: raw.whatsapp || raw.telefone || '',
    email: raw.email || '',
    canalOrigem: raw.canalOrigem || 'outro',
    empreendimento: raw.empreendimento || raw.interesse || '',
    renda: raw.renda,
    cidade: raw.cidade || '',
    status: normalizedStatus,
    etapa: normalizedStatus,
    dataCadastro: raw.dataCadastro || raw.dataCriacao || now,
    dataCriacao: raw.dataCriacao || now,
    dataAtualizacao: raw.dataAtualizacao || now,
    dataUltimoContato: raw.dataUltimoContato,
    proximoContato: raw.proximoContato,
    observacoes: raw.observacoes || '',
    dataAnalise: raw.dataAnalise || (normalizedStatus === 'em_analise' ? raw.dataAtualizacao || now : undefined),
    dataAprovacao: raw.dataAprovacao || (normalizedStatus === 'aprovados' ? raw.dataAtualizacao || now : undefined),
    dataReprovacao: raw.dataReprovacao || (normalizedStatus === 'reprovados' ? raw.dataAtualizacao || now : undefined),
    dataVenda: raw.dataVenda || (normalizedStatus === 'vendidos' ? raw.dataAtualizacao || now : undefined),
    valorAprovado: raw.valorAprovado,
    vgv: vgv,
    motivoDescarteReprovacao: raw.motivoDescarteReprovacao || raw.motivoPerda,
    vendaContabilizada: raw.vendaContabilizada ?? (normalizedStatus === 'vendidos'),
  };
}

// ==========================================
// 1. LEADS
// ==========================================
export function getStoredLeads(): CommercialLeadItem[] {
  const rawList = readFromStorage<any[]>(COMMERCIAL_STORAGE_KEYS.LEADS, []);
  if (!Array.isArray(rawList) || rawList.length === 0) return [];

  // Migração segura: remove apenas IDs pertencentes ao conjunto de demonstração
  // conhecido no código. Leads criados pelo usuário são preservados.
  const demoIds = new Set(INITIAL_COMMERCIAL_LEADS.map((lead) => lead.id));
  const productionLeads = rawList.filter((lead) => !lead?.id || !demoIds.has(lead.id));
  if (productionLeads.length !== rawList.length) {
    writeToStorage(COMMERCIAL_STORAGE_KEYS.LEADS, productionLeads);
  }

  return productionLeads.map(normalizeLead);
}

export function saveStoredLeads(leads: CommercialLeadItem[]): void {
  writeToStorage(COMMERCIAL_STORAGE_KEYS.LEADS, leads);
}

export function addStoredLead(
  lead: Omit<CommercialLeadItem, 'id' | 'dataCriacao' | 'dataAtualizacao'>
): CommercialLeadItem {
  const current = getStoredLeads();
  const now = new Date().toISOString();
  const officialStatus = normalizeLeadStatus(lead.status || lead.etapa);

  const newItem: CommercialLeadItem = {
    ...lead,
    id: `lead-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    status: officialStatus,
    etapa: officialStatus,
    dataCadastro: lead.dataCadastro || now,
    dataCriacao: now,
    dataAtualizacao: now,
    dataAnalise: officialStatus === 'em_analise' ? (lead.dataAnalise || now) : lead.dataAnalise,
    dataAprovacao: officialStatus === 'aprovados' ? (lead.dataAprovacao || now) : lead.dataAprovacao,
    dataReprovacao: officialStatus === 'reprovados' ? (lead.dataReprovacao || now) : lead.dataReprovacao,
    dataVenda: officialStatus === 'vendidos' ? (lead.dataVenda || now) : lead.dataVenda,
    vendaContabilizada: officialStatus === 'vendidos' ? true : false,
  };

  saveStoredLeads([newItem, ...current]);

  // Registro de Histórico: Lead cadastrado
  addStoredLeadHistoryEvent({
    leadId: newItem.id,
    type: 'lead_cadastrado',
    novoStatus: officialStatus,
    observacao: `Lead ${newItem.nome} cadastrado com status ${officialStatus}.`,
  });

  // Se o lead já entrou direto em status específico, registrar o evento correspondente
  if (officialStatus === 'em_analise') {
    addStoredLeadHistoryEvent({
      leadId: newItem.id,
      type: 'entrou_analise',
      novoStatus: 'em_analise',
      observacao: 'Cadastro encaminhado para análise.',
    });
  } else if (officialStatus === 'aprovados') {
    addStoredLeadHistoryEvent({
      leadId: newItem.id,
      type: 'aprovado',
      novoStatus: 'aprovados',
      valor: newItem.valorAprovado,
      observacao: 'Crédito/cadastro aprovado.',
    });
  } else if (officialStatus === 'vendidos') {
    addStoredLeadHistoryEvent({
      leadId: newItem.id,
      type: 'vendido',
      novoStatus: 'vendidos',
      valor: newItem.vgv || newItem.valorAprovado,
      observacao: 'Venda registrada no cadastro inicial.',
    });
  }

  return newItem;
}

export function updateStoredLead(
  id: string,
  updates: Partial<Omit<CommercialLeadItem, 'id' | 'dataCriacao'>>
): CommercialLeadItem | null {
  const current = getStoredLeads();
  let updatedItem: CommercialLeadItem | null = null;
  let statusChangeInfo: {
    statusAnterior: CommercialLeadStatus;
    novoStatus: CommercialLeadStatus;
  } | null = null;

  const now = new Date().toISOString();

  const next = current.map((item) => {
    if (item.id === id) {
      const statusAnterior = item.status;
      const proposedStatus = updates.status || updates.etapa;
      const novoStatus = proposedStatus ? normalizeLeadStatus(proposedStatus) : statusAnterior;

      const hasStatusChanged = novoStatus !== statusAnterior;

      if (hasStatusChanged) {
        statusChangeInfo = { statusAnterior, novoStatus };
      }

      // Aplicar regras de negócio para campos de resultado comercial
      const adjustedUpdates: Partial<CommercialLeadItem> = { ...updates };

      if (novoStatus === 'em_analise') {
        adjustedUpdates.dataAnalise = updates.dataAnalise || item.dataAnalise || now;
      } else if (novoStatus === 'aprovados') {
        adjustedUpdates.dataAprovacao = updates.dataAprovacao || item.dataAprovacao || now;
      } else if (novoStatus === 'reprovados') {
        adjustedUpdates.dataReprovacao = updates.dataReprovacao || item.dataReprovacao || now;
      } else if (novoStatus === 'vendidos') {
        adjustedUpdates.dataVenda = updates.dataVenda || item.dataVenda || now;
        adjustedUpdates.vendaContabilizada = true;
      }

      updatedItem = {
        ...item,
        ...adjustedUpdates,
        status: novoStatus,
        etapa: novoStatus,
        dataAtualizacao: now,
      };

      return updatedItem;
    }
    return item;
  });

  if (updatedItem) {
    saveStoredLeads(next);

    // Registro no Histórico de Eventos
    if (statusChangeInfo) {
      const { statusAnterior, novoStatus } = statusChangeInfo;

      let eventType: LeadHistoryEventType = 'status_alterado';
      let observacao: string | undefined = updates.observacoes;
      let valor: number | undefined = undefined;

      if (novoStatus === 'em_analise') {
        eventType = 'entrou_analise';
        observacao = 'Lead encaminhado para análise de crédito.';
      } else if (novoStatus === 'aprovados') {
        eventType = 'aprovado';
        valor = updatedItem.valorAprovado;
        observacao = updatedItem.valorAprovado
          ? `Aprovado no valor de R$ ${updatedItem.valorAprovado.toLocaleString('pt-BR')}`
          : 'Lead aprovado.';
      } else if (novoStatus === 'reprovados') {
        eventType = 'reprovado';
        observacao = updatedItem.motivoDescarteReprovacao || 'Reprovado na análise.';
      } else if (novoStatus === 'vendidos') {
        eventType = 'vendido';
        valor = updatedItem.vgv || updatedItem.valorAprovado;
        observacao = updatedItem.vgv
          ? `Venda realizada! VGV: R$ ${updatedItem.vgv.toLocaleString('pt-BR')}`
          : 'Venda realizada com sucesso.';
      } else if (novoStatus === 'descartados') {
        eventType = 'descartado';
        observacao = updatedItem.motivoDescarteReprovacao || 'Lead descartado.';
      }

      addStoredLeadHistoryEvent({
        leadId: id,
        type: eventType,
        statusAnterior,
        novoStatus,
        observacao,
        valor,
      });
    }
  }

  return updatedItem;
}

// Alteração rápida de status com suporte a parâmetros comerciais
export function updateStoredLeadStatus(
  id: string,
  novoStatus: CommercialLeadStatus,
  detalhes?: {
    valorAprovado?: number;
    vgv?: number;
    motivoDescarteReprovacao?: string;
    observacao?: string;
  }
): CommercialLeadItem | null {
  return updateStoredLead(id, {
    status: novoStatus,
    etapa: novoStatus,
    valorAprovado: detalhes?.valorAprovado,
    vgv: detalhes?.vgv,
    motivoDescarteReprovacao: detalhes?.motivoDescarteReprovacao,
    observacoes: detalhes?.observacao,
    dataUltimoContato: new Date().toISOString(),
  });
}

export function updateStoredLeadStage(
  id: string,
  etapa: CommercialFunnelStage,
  motivoPerda?: string
): CommercialLeadItem | null {
  const official = normalizeLeadStatus(etapa);
  return updateStoredLead(id, {
    status: official,
    etapa: official,
    motivoDescarteReprovacao: motivoPerda,
    dataUltimoContato: new Date().toISOString(),
  });
}

export function deleteStoredLead(id: string): boolean {
  const current = getStoredLeads();
  const filtered = current.filter((l) => l.id !== id);
  if (filtered.length !== current.length) {
    saveStoredLeads(filtered);
    // Também limpa histórico associado
    const allHistory = getStoredLeadHistory();
    const filteredHistory = allHistory.filter((h) => h.leadId !== id);
    writeToStorage(COMMERCIAL_STORAGE_KEYS.LEAD_HISTORY, filteredHistory);
    return true;
  }
  return false;
}

// ==========================================
// 2. HISTÓRICO DE EVENTOS DO LEAD
// ==========================================
export function getStoredLeadHistory(): CommercialLeadHistoryEvent[] {
  return readFromStorage<CommercialLeadHistoryEvent[]>(COMMERCIAL_STORAGE_KEYS.LEAD_HISTORY, []);
}

export function getLeadHistory(leadId: string): CommercialLeadHistoryEvent[] {
  const all = getStoredLeadHistory();
  return all
    .filter((h) => h.leadId === leadId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function addStoredLeadHistoryEvent(
  event: Omit<CommercialLeadHistoryEvent, 'id' | 'createdAt'> & { createdAt?: string }
): CommercialLeadHistoryEvent {
  const current = getStoredLeadHistory();
  const newEvent: CommercialLeadHistoryEvent = {
    id: `ev-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    createdAt: event.createdAt || new Date().toISOString(),
    leadId: event.leadId,
    type: event.type,
    statusAnterior: event.statusAnterior,
    novoStatus: event.novoStatus,
    observacao: event.observacao,
    valor: event.valor,
  };
  writeToStorage(COMMERCIAL_STORAGE_KEYS.LEAD_HISTORY, [newEvent, ...current]);
  return newEvent;
}

// ==========================================
// 3. BALANÇOS COMERCIAIS (DIÁRIO, SEMANAL, MENSAL)
// ==========================================
function isSameDate(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

function getStartAndEndOfWeek(date: Date): { start: Date; end: Date } {
  const d = new Date(date);
  const day = d.getDay();
  const diffToMonday = d.getDate() - day + (day === 0 ? -6 : 1); // ajusta domingo para 6
  const start = new Date(d.setDate(diffToMonday));
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

export function calculateCommercialBalance(
  leads: CommercialLeadItem[],
  periodo: 'diario' | 'semanal' | 'mensal',
  baseDate: Date = new Date()
) {
  const totalLeads = leads.length;

  let leadsNoPeriodo: CommercialLeadItem[] = [];
  let dataInicioStr = '';
  let dataFimStr = '';

  if (periodo === 'diario') {
    leadsNoPeriodo = leads.filter((l) => {
      const cad = new Date(l.dataCadastro || l.dataCriacao);
      return isSameDate(cad, baseDate);
    });
    dataInicioStr = baseDate.toLocaleDateString('pt-BR');
    dataFimStr = dataInicioStr;
  } else if (periodo === 'semanal') {
    const { start, end } = getStartAndEndOfWeek(baseDate);
    leadsNoPeriodo = leads.filter((l) => {
      const cad = new Date(l.dataCadastro || l.dataCriacao);
      return cad >= start && cad <= end;
    });
    dataInicioStr = start.toLocaleDateString('pt-BR');
    dataFimStr = end.toLocaleDateString('pt-BR');
  } else {
    // Mensal
    leadsNoPeriodo = leads.filter((l) => {
      const cad = new Date(l.dataCadastro || l.dataCriacao);
      return cad.getFullYear() === baseDate.getFullYear() && cad.getMonth() === baseDate.getMonth();
    });
    const firstDay = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
    const lastDay = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0);
    dataInicioStr = firstDay.toLocaleDateString('pt-BR');
    dataFimStr = lastDay.toLocaleDateString('pt-BR');
  }

  // Contagens do período (baseadas nas datas de evento ou status para leads do período)
  const cadastrados = leadsNoPeriodo.length;

  // Leads atualmente em atendimentos, não atenderam, descartados
  const atendimentos = leads.filter((l) => l.status === 'atendimentos').length;
  const naoAtenderam = leads.filter((l) => l.status === 'nao_atenderam').length;
  const descartados = leads.filter((l) => l.status === 'descartados').length;

  // Análises: leads com dataAnalise no período (ou status em_analise se dentro do periodo)
  const analises = leads.filter((l) => {
    if (l.dataAnalise) {
      const d = new Date(l.dataAnalise);
      if (periodo === 'diario') return isSameDate(d, baseDate);
      if (periodo === 'semanal') {
        const { start, end } = getStartAndEndOfWeek(baseDate);
        return d >= start && d <= end;
      }
      return d.getFullYear() === baseDate.getFullYear() && d.getMonth() === baseDate.getMonth();
    }
    return l.status === 'em_analise' && leadsNoPeriodo.some((p) => p.id === l.id);
  }).length;

  // Aprovados no período
  const aprovados = leads.filter((l) => {
    if (l.dataAprovacao) {
      const d = new Date(l.dataAprovacao);
      if (periodo === 'diario') return isSameDate(d, baseDate);
      if (periodo === 'semanal') {
        const { start, end } = getStartAndEndOfWeek(baseDate);
        return d >= start && d <= end;
      }
      return d.getFullYear() === baseDate.getFullYear() && d.getMonth() === baseDate.getMonth();
    }
    return l.status === 'aprovados' && leadsNoPeriodo.some((p) => p.id === l.id);
  }).length;

  // Reprovados no período
  const reprovados = leads.filter((l) => {
    if (l.dataReprovacao) {
      const d = new Date(l.dataReprovacao);
      if (periodo === 'diario') return isSameDate(d, baseDate);
      if (periodo === 'semanal') {
        const { start, end } = getStartAndEndOfWeek(baseDate);
        return d >= start && d <= end;
      }
      return d.getFullYear() === baseDate.getFullYear() && d.getMonth() === baseDate.getMonth();
    }
    return l.status === 'reprovados' && leadsNoPeriodo.some((p) => p.id === l.id);
  }).length;

  // Vendidos e VGV no período
  const leadsVendidosPeriodo = leads.filter((l) => {
    if (l.status !== 'vendidos' && !l.dataVenda) return false;
    if (l.dataVenda) {
      const d = new Date(l.dataVenda);
      if (periodo === 'diario') return isSameDate(d, baseDate);
      if (periodo === 'semanal') {
        const { start, end } = getStartAndEndOfWeek(baseDate);
        return d >= start && d <= end;
      }
      return d.getFullYear() === baseDate.getFullYear() && d.getMonth() === baseDate.getMonth();
    }
    return l.status === 'vendidos' && leadsNoPeriodo.some((p) => p.id === l.id);
  });

  const vendidos = leadsVendidosPeriodo.length;

  const vgv = leadsVendidosPeriodo.reduce((acc, curr) => {
    const val = typeof curr.vgv === 'number' ? curr.vgv : typeof curr.valorAprovado === 'number' ? curr.valorAprovado : 0;
    return acc + val;
  }, 0);

  // Conversões
  const taxaConversaoAnalise = cadastrados > 0 ? (analises / cadastrados) * 100 : 0;
  const taxaConversaoVenda = cadastrados > 0 ? (vendidos / cadastrados) * 100 : totalLeads > 0 ? (vendidos / totalLeads) * 100 : 0;
  const taxaConversaoGeral = totalLeads > 0 ? (leads.filter((l) => l.status === 'vendidos').length / totalLeads) * 100 : 0;

  return {
    periodo,
    dataInicio: dataInicioStr,
    dataFim: dataFimStr,
    cadastrados,
    atendimentos,
    naoAtenderam,
    descartados,
    analises,
    aprovados,
    reprovados,
    vendidos,
    vgv,
    taxaConversaoAnalise,
    taxaConversaoVenda,
    taxaConversaoGeral,
  };
}

// ==========================================
// 4. INTERAÇÕES, VISITAS, PROPOSTAS, VENDAS, METAS (Compatibilidade Segura)
// ==========================================
export function getStoredInteractions(): CommercialInteractionItem[] {
  return readFromStorage<CommercialInteractionItem[]>(COMMERCIAL_STORAGE_KEYS.INTERACTIONS, []);
}

export function saveStoredInteractions(interactions: CommercialInteractionItem[]): void {
  writeToStorage(COMMERCIAL_STORAGE_KEYS.INTERACTIONS, interactions);
}

export function addStoredInteraction(
  interaction: Omit<CommercialInteractionItem, 'id' | 'dataCriacao'>
): CommercialInteractionItem {
  const current = getStoredInteractions();
  const newItem: CommercialInteractionItem = {
    ...interaction,
    id: `inter-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    dataCriacao: new Date().toISOString(),
  };
  saveStoredInteractions([newItem, ...current]);
  return newItem;
}

export function getStoredVisits(): CommercialVisitItem[] {
  return readFromStorage<CommercialVisitItem[]>(COMMERCIAL_STORAGE_KEYS.VISITS, []);
}

export function saveStoredVisits(visits: CommercialVisitItem[]): void {
  writeToStorage(COMMERCIAL_STORAGE_KEYS.VISITS, visits);
}

export function addStoredVisit(visit: Omit<CommercialVisitItem, 'id' | 'dataCriacao'>): CommercialVisitItem {
  const current = getStoredVisits();
  const newItem: CommercialVisitItem = {
    ...visit,
    id: `vis-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    dataCriacao: new Date().toISOString(),
  };
  saveStoredVisits([newItem, ...current]);
  return newItem;
}

export function updateStoredVisitStatus(id: string, status: VisitStatus): CommercialVisitItem | null {
  const current = getStoredVisits();
  let updatedItem: CommercialVisitItem | null = null;
  const next = current.map((item) => {
    if (item.id === id) {
      updatedItem = { ...item, status };
      return updatedItem;
    }
    return item;
  });
  if (updatedItem) {
    saveStoredVisits(next);
  }
  return updatedItem;
}

export function getStoredProposals(): CommercialProposalItem[] {
  return readFromStorage<CommercialProposalItem[]>(COMMERCIAL_STORAGE_KEYS.PROPOSALS, []);
}

export function saveStoredProposals(proposals: CommercialProposalItem[]): void {
  writeToStorage(COMMERCIAL_STORAGE_KEYS.PROPOSALS, proposals);
}

export function addStoredProposal(
  proposal: Omit<CommercialProposalItem, 'id' | 'dataCriacao'>
): CommercialProposalItem {
  const current = getStoredProposals();
  const newItem: CommercialProposalItem = {
    ...proposal,
    id: `prop-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    dataCriacao: new Date().toISOString(),
  };
  saveStoredProposals([newItem, ...current]);
  return newItem;
}

export function updateStoredProposalStatus(id: string, status: ProposalStatus): CommercialProposalItem | null {
  const current = getStoredProposals();
  let updatedItem: CommercialProposalItem | null = null;
  const next = current.map((item) => {
    if (item.id === id) {
      updatedItem = { ...item, status };
      return updatedItem;
    }
    return item;
  });
  if (updatedItem) {
    saveStoredProposals(next);
  }
  return updatedItem;
}

export function getStoredSales(): CommercialSaleItem[] {
  return readFromStorage<CommercialSaleItem[]>(COMMERCIAL_STORAGE_KEYS.SALES, []);
}

export function saveStoredSales(sales: CommercialSaleItem[]): void {
  writeToStorage(COMMERCIAL_STORAGE_KEYS.SALES, sales);
}

export function addStoredSale(sale: Omit<CommercialSaleItem, 'id' | 'dataCriacao'>): CommercialSaleItem {
  const current = getStoredSales();
  const newItem: CommercialSaleItem = {
    ...sale,
    id: `sale-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    dataCriacao: new Date().toISOString(),
  };
  saveStoredSales([newItem, ...current]);
  return newItem;
}

export function updateStoredSaleStatus(id: string, status: SaleStatus): CommercialSaleItem | null {
  const current = getStoredSales();
  let updatedItem: CommercialSaleItem | null = null;
  const next = current.map((item) => {
    if (item.id === id) {
      updatedItem = { ...item, status };
      return updatedItem;
    }
    return item;
  });
  if (updatedItem) {
    saveStoredSales(next);
  }
  return updatedItem;
}

export function getStoredCommercialGoals(): CommercialGoalItem[] {
  const rawList = readFromStorage<CommercialGoalItem[]>(COMMERCIAL_STORAGE_KEYS.GOALS, []);
  if (!Array.isArray(rawList) || rawList.length === 0) return [];

  // Remove apenas metas de demonstração identificadas pelos IDs do seed original.
  const demoIds = new Set(INITIAL_COMMERCIAL_GOALS.map((goal) => goal.id));
  const productionGoals = rawList.filter((goal) => !demoIds.has(goal.id));
  if (productionGoals.length !== rawList.length) {
    writeToStorage(COMMERCIAL_STORAGE_KEYS.GOALS, productionGoals);
  }
  return productionGoals;
}

export function saveStoredCommercialGoals(goals: CommercialGoalItem[]): void {
  writeToStorage(COMMERCIAL_STORAGE_KEYS.GOALS, goals);
}

export function addStoredCommercialGoal(
  goal: Omit<CommercialGoalItem, 'id' | 'dataCriacao' | 'dataAtualizacao'>
): CommercialGoalItem {
  const current = getStoredCommercialGoals();
  const now = new Date().toISOString();
  const newItem: CommercialGoalItem = {
    ...goal,
    id: `cgoal-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    dataCriacao: now,
    dataAtualizacao: now,
  };
  saveStoredCommercialGoals([newItem, ...current]);
  return newItem;
}

export function updateStoredCommercialGoal(
  id: string,
  updates: Partial<Omit<CommercialGoalItem, 'id' | 'dataCriacao'>>
): CommercialGoalItem | null {
  const current = getStoredCommercialGoals();
  let updatedItem: CommercialGoalItem | null = null;
  const next = current.map((item) => {
    if (item.id === id) {
      updatedItem = {
        ...item,
        ...updates,
        dataAtualizacao: new Date().toISOString(),
      };
      return updatedItem;
    }
    return item;
  });
  if (updatedItem) {
    saveStoredCommercialGoals(next);
  }
  return updatedItem;
}

// ==========================================
// SNAPSHOT & UTILITÁRIOS GERAIS
// ==========================================
export function getCommercialDataSnapshot(): CommercialDataSnapshot {
  return {
    leads: getStoredLeads(),
    history: getStoredLeadHistory(),
    interactions: getStoredInteractions(),
    visits: getStoredVisits(),
    proposals: getStoredProposals(),
    sales: getStoredSales(),
    goals: getStoredCommercialGoals(),
  };
}

export function clearCommercialStorage(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  Object.values(COMMERCIAL_STORAGE_KEYS).forEach((key) => {
    localStorage.removeItem(key);
  });
  window.dispatchEvent(
    new CustomEvent(COMMERCIAL_UPDATE_EVENT, { detail: { cleared: true, timestamp: Date.now() } })
  );
}
