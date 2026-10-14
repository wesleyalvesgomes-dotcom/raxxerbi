# RAXXER BI — auditoria e plano de autonomia

## Estado observado no código

- Frontend React + TypeScript + Vite.
- API de IA executada por Cloudflare Worker, com chamadas ao Gemini.
- Dados pessoais e comerciais mantidos no `localStorage`; isso não oferece sincronização confiável entre navegadores/dispositivos nem execução em segundo plano.
- Não foi encontrado binding D1/R2, autenticação de usuário, isolamento por usuário, agenda Cron, fila de execução ou rotina de recuperação de falhas.
- O Worker aceita chamadas às rotas de IA sem autenticar o usuário. Se publicado assim, terceiros podem consumir a cota da chave Gemini.
- O código usava `gemini-3.7-flash`, que foi descontinuado em 8 de outubro de 2026; o Google encaminha chamadas para o modelo substituto, mas recomenda atualizar o identificador para `gemini-3.8-flash`.
- O contrato de ações do chat estava divergente: o schema declarava `type + payload`, enquanto a interface executava campos diretos e esperava nomes diferentes.
- Os dados comerciais de demonstração eram carregados automaticamente quando o armazenamento estava vazio, contaminando os indicadores.
- A referência de data do prompt usava UTC; para o usuário no Brasil, isso pode deslocar a data perto da virada do dia.

## Correções incluídas nesta branch

1. Padronização do contrato de ações da IA para campos diretos e nomes usados pela interface: `add_task`, `update_task_status`, `reschedule_task`, `add_memory` e `add_goal`.
2. Correção da leitura do histórico do chat (`role`, não `sender`).
3. Validação de campos mínimos antes de criar memória/tarefa/meta, alterar status ou reagendar.
4. Bloqueio da exclusão permanente de tarefas por ação gerada pela IA; o caminho seguro é cancelar.
5. Parada do carregamento automático de leads/metas fictícios e migração dos registros com IDs do conjunto de demonstração conhecido.
6. Uso de data de São Paulo compartilhada pelo prompt, painel, histórico diário e telas de tarefas.
7. Atualização do identificador do Gemini para `gemini-3.8-flash`, conforme a documentação oficial do Google.
8. Remoção da reescrita global de “Alex” para “Wesley” no armazenamento local, que poderia corromper memórias legítimas.
9. Correção dos contadores do histórico diário, que antes tratavam todas as tarefas acumuladas como atividade de hoje.
10. Alteração de status/reagendamento somente quando existe um único alvo; caso contrário, o chat informa que não executou.
11. Bloqueio da criação automática de tarefas e metas inferidas no onboarding.

## Plano para o RAXXER operar com autonomia

### P0 — Segurança e integridade antes de produção

- Criar autenticação real e autorização no servidor; não confiar em dados de perfil enviados pelo browser.
- Proteger todas as rotas `/api/ai/*`, limitar tamanho de payload, aplicar rate limit e controlar custos.
- Gerar e versionar um `package-lock.json` para instalações reproduzíveis.
- Adicionar testes de contrato para todas as ações da IA e testes de migração que comprovem que dados reais são preservados.
- Revisar todas as fontes de datas para usar um fuso horário consistente e não gravar histórico fictício.
- Adicionar log de auditoria para ações executadas, erros e alterações de dados.

### P1 — Fonte de verdade persistente

- Migrar perfil, tarefas, metas, memórias, histórico e dados comerciais para Cloudflare D1.
- Criar schema versionado/migrations, chaves de usuário e isolamento de todos os registros por usuário.
- Usar R2 somente para arquivos/documentos; não armazenar arquivos grandes em D1/localStorage.
- Criar exportação e estratégia de backup/recuperação.
- Migrar dados locais existentes com prévia e confirmação, sem apagar dados do usuário.

### P2 — Motor de execução autônoma

- Criar tabela de tarefas agendadas e uma fila/outbox persistente com estados: pendente, em execução, concluída, falhou e próxima tentativa.
- Usar Cron Triggers para verificar trabalhos vencidos e executar apenas ações autorizadas.
- Garantir idempotência, retry com limite, registro de resultado e prevenção de execução duplicada.
- Exigir confirmação para ações externas ou irreversíveis (por exemplo, enviar mensagens, excluir dados ou assumir compromissos).
- Implementar notificações e integrações só após definir provedores, credenciais e permissões.

### P3 — Operação confiável

- Pipeline CI para build e TypeScript.
- Monitoramento de erros, latência e consumo de IA; alertas de falha.
- Testes de fluxo ponta a ponta: registrar tarefa por linguagem natural, confirmar persistência, reabrir sessão e verificar o resultado.
- Painel de saúde do agente: última execução, próximos trabalhos, falhas e ações aguardando aprovação.

## Critério de pronto para autonomia

O RAXXER só deve ser considerado autônomo quando conseguir, sem a tela aberta, recuperar trabalho persistido, executar no horário certo, registrar o resultado, lidar com falhas sem duplicar ações e provar quem autorizou cada operação. Até lá, as alterações automáticas devem ficar limitadas a ações locais e reversíveis.
