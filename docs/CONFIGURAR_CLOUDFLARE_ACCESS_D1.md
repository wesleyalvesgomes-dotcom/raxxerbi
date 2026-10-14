# Configuração necessária: Cloudflare Access + D1

Esta branch prepara a base de autenticação e o schema. **Não está pronta para publicar até a configuração abaixo estar concluída.** O identificador do banco no wrangler.toml é intencionalmente um placeholder.

## 1. Criar o banco D1

1. No painel Cloudflare, crie um banco D1 chamado raxxerbi-db.
2. Copie o UUID real do banco e substitua REPLACE_WITH_CLOUDFLARE_D1_DATABASE_ID em wrangler.toml.
3. A partir de um ambiente autenticado com Wrangler, aplique a migração primeiro em preview e depois em produção:
   - npx wrangler d1 migrations apply raxxerbi-db --local
   - npx wrangler d1 migrations apply raxxerbi-db --remote
4. Confirme que a migração 0001_initial_schema.sql aparece como aplicada antes de publicar o Worker.

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
- A migração cria tabelas para perfil, tarefas, metas, memórias, projetos, histórico, revisões, dados comerciais, trabalhos agendados, auditoria, registros genéricos por usuário e contadores de limite de uso da IA. O Worker aplica limite fixo de 30 chamadas à IA por usuário por minuto. O motor Cron ainda será implementado em etapa seguinte.
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
- Coleções permitidas: profile, tasks, goals, memories, projects, daily_history, weekly_reviews, commercial_leads, commercial_lead_history, commercial_interactions, commercial_visits, commercial_proposals, commercial_sales e commercial_goals.
- Cada item tem limite de 64 KB; a API não aceita user_id do cliente. Não faça a migração automática do localStorage até implementar e testar a estratégia de importação, reconciliação e recuperação.
