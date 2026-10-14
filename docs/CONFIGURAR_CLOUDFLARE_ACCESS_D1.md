# Configuração necessária: Cloudflare Access + D1

Esta branch prepara a base de autenticação e o schema. **Não está pronta para publicar até a configuração abaixo estar concluída.** O identificador do banco no wrangler.toml é intencionalmente um placeholder.

## 1. Criar o banco D1

1. No painel Cloudflare, crie um banco D1 chamado raxxerbi-db.
2. Copie o UUID real do banco e substitua REPLACE_WITH_CLOUDFLARE_D1_DATABASE_ID em wrangler.toml.
3. A partir de um ambiente autenticado com Wrangler, aplique a migração primeiro em preview e depois em produção:
   - npx wrangler d1 migrations apply raxxerbi-db --local
   - npx wrangler d1 migrations apply raxxerbi-db --remote
4. Confirme que as migrações 0001_initial_schema.sql e 0002_scheduled_job_recurrence.sql aparecem como aplicadas antes de publicar o Worker.

Não aplique a migração em produção antes de confirmar o banco correto e revisar a configuração.

## 2. Proteger o app com Cloudflare Access

1. Crie uma aplicação self-hosted no Cloudflare Zero Trust para o domínio do RAXXER.
2. Configure uma política que permita somente a identidade/identidades autorizadas.
3. Proteja tanto a interface quanto as rotas /api/*; não deixe as rotas de IA acessíveis fora do Access.
4. No Worker, configure:
   - ACCESS_TEAM_DOMAIN: domínio da equipe, sem https:// (por exemplo, minha-equipe.cloudflareaccess.com).
   - ACCESS_AUD: Audience (AUD) da aplicação Access.
   - GEMINI_API_KEY: secret existente para chamadas Gemini.
5. Teste que uma chamada direta sem Cf-Access-Jwt-Assertion retorna 401 e que uma identidade autorizada consegue chamar GET /api/me.

O Worker valida assinatura RS256, emissor, audiência, expiração e identidade do JWT. Ele não confia em user_id enviado pelo navegador. A primeira requisição autenticada registra/atualiza a identidade no D1; contas marcadas com disabled_at são negadas.

## 3. Limites desta etapa

- Esta alteração protege as rotas do Worker, registra a identidade autenticada e disponibiliza a API autenticada de registros por coleção em /api/data/:collection e /api/data/:collection/:id. As coleções permitidas estão em allowlist e cada consulta é isolada pelo ID verificado do usuário. A interface ainda não foi migrada do localStorage para usar esses endpoints.
- A interface atual ainda não tem um fluxo de login próprio; a autenticação é fornecida pelo portal Cloudflare Access.
- O servidor Express local (server.ts) é para desenvolvimento e não substitui a proteção do Worker de produção. Não publique o Express diretamente na internet.
- As migrações criam tabelas para perfil, tarefas, metas, memórias, projetos, histórico, revisões, dados comerciais, trabalhos agendados, auditoria, registros genéricos por usuário e contadores de limite de uso da IA. O Worker aplica limite fixo de 30 chamadas à IA por usuário por minuto. O Cron consulta a fila a cada cinco minutos, reivindica jobs atomicamente, registra auditoria e tenta novamente falhas até três tentativas.
- A configuração Cloudflare real não pode ser concluída pelo repositório sozinho; depende do UUID do D1, do domínio/AUD do Access e das permissões do painel.

## 4. Checklist de verificação antes de produção

- [ ] UUID D1 real configurado; nenhum placeholder restante.
- [ ] Migração aplicada ao banco correto.
- [ ] Access protege a interface e todas as rotas /api/*.
- [ ] ACCESS_TEAM_DOMAIN, ACCESS_AUD e GEMINI_API_KEY configurados como vars/secrets adequados.
- [ ] Sem token: API retorna 401; configuração de auth ausente: API retorna 503.
- [ ] Conta desativada no D1 recebe 403.
- [ ] Testes de integração executados antes de publicar.


## API de dados disponível nesta etapa

- GET /api/data/:collection lista os registros daquela coleção para o usuário autenticado.
- GET /api/data/:collection/:id lê um registro específico.
- PUT /api/data/:collection/:id com JSON { "data": ... } cria/atualiza um registro.
- DELETE /api/data/:collection/:id remove somente aquele registro do usuário autenticado.
- Coleções permitidas: profile, tasks, goals, memories, projects, daily_history, weekly_reviews, commercial_leads, commercial_lead_history, commercial_interactions, commercial_visits, commercial_proposals, commercial_sales, commercial_goals e scheduled_outputs.
- Cada item tem limite de 64 KB; a API não aceita user_id do cliente. Não faça a migração automática do localStorage até implementar e testar a estratégia de importação, reconciliação e recuperação.


## Sincronização segura do navegador para D1

A interface oferece **Dados e backup** no canto inferior. A sincronização é manual e só ocorre após clicar no botão; não há envio automático na inicialização.

- Exportar backup gera um JSON com as chaves locais suportadas. O arquivo contém dados pessoais e comerciais; proteja-o.
- Sincronizar verifica a identidade em `/api/me`, envia apenas registros ausentes na nuvem e importa registros que faltam localmente.
- Ao concluir, a ativação da sincronização contínua fica pendente até recarregar a aplicação, para inicializar o estado React com os dados mesclados antes de voltar a enviar alterações.
- Em caso de conflito de ID na migração, os dois lados não são sobrescritos: o registro local continua local e o remoto continua remoto.
- Depois da ativação, alterações locais são enviadas automaticamente. Cada item usa versão otimista (`updatedAt`) para bloquear gravações/exclusões se o registro remoto mudou desde a última sincronização; conflitos são registrados localmente e não sobrescrevem o remoto.
- IDs conhecidos de dados-semente antigos (padrões `task-1`, `goal-1`, `proj-1`, `mem-1`, `review-1`) não são enviados como registros reais.
- A sincronização cobre perfil, tarefas, metas, memórias, projetos, histórico diário, revisões semanais e coleções do BI comercial.
- Após sincronizar, use **Recarregar aplicação** para carregar os registros recém-importados e ativar a sincronização contínua.

## Execução agendada

O Worker usa um Cron Trigger a cada cinco minutos. A API exige identidade Cloudflare Access verificada e só permite dois tipos fechados de job: `daily_briefing` e `weekly_review`. O job gera um resumo determinístico a partir de tarefas e metas existentes; não cria tarefas, metas ou hábitos.

- `GET /api/jobs`: lista agendamentos do usuário autenticado.
- `POST /api/jobs`: cria um agendamento com `type`, `runAt` ISO 8601, `recurrence` (`once`, `daily`, `weekly`) e `idempotencyKey`.
- `DELETE /api/jobs/:id`: cancela apenas um job pendente pertencente ao usuário.
- Resultados aparecem em `GET /api/data/scheduled_outputs`.
- O mecanismo limita a consulta a 25 jobs por execução, reivindica cada job com atualização condicional, recupera jobs `running` abandonados após 15 minutos, usa até três tentativas e registra sucessos/falhas em `audit_log`.
- Recorrências são reprogramadas após a execução com intervalo diário ou semanal. O horário é relativo ao momento em que a execução terminou; isso evita uma fila de execuções atrasadas após indisponibilidade.
- O resultado é persistido no D1. Este estágio não envia notificações por e-mail, WhatsApp ou push; não há integração externa configurada.

### Antes de considerar pronto para produção

- [ ] Aplicar ambas as migrações em D1 de teste e validar a fila.
- [ ] Validar Access com uma identidade real e uma conta desativada.
- [ ] Fazer sincronização manual com backup e conferir os conflitos preservados.
- [ ] Confirmar que o Cron Trigger aparece no Worker publicado e executar um job de teste.
- [ ] Configurar o UUID D1 real, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` e o secret `GEMINI_API_KEY`.
- [ ] Não mesclar nem publicar enquanto o CI e os testes de integração com Cloudflare real não passarem.
