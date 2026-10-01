/**
 * APIFY — a área independente do núcleo OSINT (FASE D).
 *
 * Oito actors da Store, um registry aberto, e três verdades que a ferramenta
 * diz sempre, mesmo quando custam:
 *
 *   1. **Sem token não há busca.** `APIFY_API_TOKEN` em falta →
 *      `NOT_CONFIGURED` a nomear a variável exata. Nenhum finding é fabricado
 *      para preencher o ecrã.
 *   2. **Correr custa dinheiro.** Os oito actors são `pay-per-event`, por isso
 *      nada corre sem `confirmarCusto = sim`. Sem essa confirmação o estado é
 *      `AGUARDA_CONFIRMACAO`, com o que ia ser executado escrito à vista.
 *   3. **O que vem, vem todo.** Sem limite artificial de itens: o normalizador
 *      destaca os campos públicos conhecidos e guarda o item inteiro por baixo,
 *      para o investigador ver o que a fonte realmente devolveu.
 *
 * O token vive no backend, vai no header `Authorization` e nunca aparece em
 * findings, mensagens ou URLs — `limpar()` trata de qualquer texto de erro.
 */
import { registerTool } from '../registry.ts';
import { SourceLog, finding, type Finding } from '../net/provenance.ts';
import {
  ACTORS, correr, escolherActors, limpar, saude, token,
  type ActorDef,
} from '../net/apify.ts';

const src = (a: ActorDef) => `apify-${a.actorId}`;
registerTool({
  id: 'apify',
  name: 'APIFY',
  category: 'pessoa',
  summary: 'Actors do Apify (Instagram, TikTok, Facebook, X) como engine separado, com token só no backend.',
  longDesc: 'Registry aberto de oito actors verificados na Store do Apify. Sem APIFY_API_TOKEN o estado é NOT_CONFIGURED — a ferramenta recusa e diz exatamente o que falta. Os actors são pay-per-event, por isso exigem confirmarCusto=sim antes de correr. A saída não é limitada artificialmente: vem tudo o que o actor devolveu, com o token sempre fora de vista. Três dos oito actors não são apify/* (TikTok ×2, Tweet) e aparecem marcados como de terceiros; o apidojo/tweet-scraper está marcado como indisponível via API na conta Free (só demo na Console, exige plano pago).',
  minPlan: 'free',
  freeTier: true,
  legalGate: 'lgpd',
  tags: ['apify', 'instagram', 'tiktok', 'facebook', 'x', 'scraper'],
  fields: [
    { name: 'alvo', label: 'Alvo', type: 'text', placeholder: 'ex: @perfil | https://www.instagram.com/perfil/ | https://www.tiktok.com/@perfil', required: true, hint: 'Username, URL de perfil/post ou handle — depende do actor.' },
    { name: 'plataforma', label: 'Plataforma', type: 'text', placeholder: 'instagram | tiktok | facebook | x', required: false, hint: 'Por omissão, todos os oito actors.' },
    { name: 'actors', label: 'Actors', type: 'text', placeholder: 'ex: apify/instagram-scraper, instagram', required: false, hint: 'Por omissão, os escolhidos pela plataforma.' },
    { name: 'confirmarCusto', label: 'Confirmar custo', type: 'text', placeholder: 'sim', required: false, hint: 'Os actors são pay-per-event: sem "sim" nada corre e fica dito o que ia correr.' },
  ],
  async run(input) {
    const alvo = String(input.alvo ?? '').trim();
    const log = new SourceLog();
    const out: Finding[] = [];
    const notes: string[] = [];

    if (!alvo || alvo.length > 300 || /[\s<>"]/.test(alvo)) {
      out.push(finding('validacao', 'Alvo', alvo ? `inválido: "${alvo.slice(0, 80)}"` : 'em falta',
        [], { kind: 'claim', confidence: 'confirmed' }));
      notes.push('O alvo não pode ter espaços, aspas ou mais de 300 caracteres.');
      return { findings: out, log, notes };
    }

    const escolhidos = escolherActors(input.plataforma, input.actors);
    if (!escolhidos.length) {
      out.push(finding('validacao', 'Actors', 'nenhum actor corresponde aos filtros', [], { kind: 'claim', confidence: 'confirmed' }));
      notes.push(`Actors disponíveis: ${ACTORS.map((a) => a.actorId).join(', ')}`);
      return { findings: out, log, notes };
    }

    // A conta Free não pode correr todos os actors via API. Diz-se ANTES de
    // qualquer pedido: nada se gasta a descobrir no meio de um run que aquele
    // actor só funciona em modo demo na Console do Apify.
    const naFree = escolhidos.filter((a) => !a.viaApiNaFree);
    if (naFree.length) {
      notes.push(`${naFree.map((a) => a.actorId).join(', ')}: indisponível via API na conta Apify Free (só demo na Console) — correr pelo ARGOS exige plano pago da Apify.`);
    }

    const confirma = String(input.confirmarCusto ?? '').trim().toLowerCase() === 'sim';
    const t = token();
    const contas: Record<string, number> = { READY: 0, NOT_CONFIGURED: 0, AGUARDA_CONFIRMACAO: 0, ERROR: 0, RATE_LIMITED: 0, PAYMENT_REQUIRED: 0, DISABLED: 0 };

    // O alvo é aquilo que o utilizador escreveu: origem declarada é o cálculo local.
    log.local(0, 'alvo introduzido pelo utilizador — não é achado de uma fonte externa');
    out.push(finding('motor', 'Alvo', alvo, ['local'], { kind: 'fact', confidence: 'confirmed' }));

    if (!t.token) {
      const nota = `${t.falta} em falta — a APIFY do ARGOS está desligada (a chave só existe no backend e nunca é devolvida pela API)`;
      log.needsKey('apify', 'Apify', 'https://apify.com', `${t.falta} em falta`);
      for (const a of escolhidos) {
        contas.NOT_CONFIGURED++;
        // O achado cita o actor, portanto o actor tem de existir na matriz de
        // fontes: declara-se como fonte consultada e recusada, com o motivo.
        // Sem isto a proveniência acusa "fonte inexistente" (audit-tools.ts).
        log.skipped(src(a), a.name, `https://apify.com/${a.actorId}`, `NOT_CONFIGURED — ${t.falta} em falta`);
        out.push(finding('actor', `${a.name}`, `NOT_CONFIGURED — ${t.falta} em falta`, [src(a)], { kind: 'fact', confidence: 'confirmed' }));
      }
      out.push(finding('resumo', 'Actors prontos', 0, ['apify'], { kind: 'fact', confidence: 'confirmed' }));
      notes.push(nota);
      notes.push(`Declare ${t.falta} no ambiente do servidor (backend/secret manager) para ativar os ${escolhidos.length} actors.`);
      return { findings: out, log, notes };
    }

    for (const a of escolhidos) {
      if (!a.enabled) {
        contas.DISABLED++;
        log.skipped(src(a), a.name, `https://apify.com/${a.actorId}`, 'actor desativado no registry');
        out.push(finding('actor', a.name, 'DISABLED — actor desativado', [src(a)], { kind: 'fact', confidence: 'confirmed' }));
        continue;
      }
      if (!confirma) {
        contas.AGUARDA_CONFIRMACAO++;
        const plano = JSON.stringify(a.input(alvo));
        log.skipped(src(a), a.name, `https://apify.com/${a.actorId}`,
          `aguarda confirmação de custo (pay-per-event); input seria ${plano}`);
        out.push(finding('actor', a.name,
          `AGUARDA_CONFIRMACAO — actor ${a.oficial ? '' : '(de terceiros) '}pay-per-event; nada executado. Input: ${plano}`,
          [src(a)], { kind: 'fact', confidence: 'confirmed' }));
        continue;
      }
      const r = await correr(a, alvo);
      contas[r.status]++;
      if (r.status === 'READY') {
        log.ok(src(a), a.name, `https://apify.com/${a.actorId}`, r.ms, r.itens.length, r.nota);
        out.push(finding('actor', a.name, `READY — ${r.itens.length} item(ns)${a.oficial ? '' : ' · actor de terceiros'}`, [src(a)], { kind: 'fact', confidence: 'indicated' }));
        let n = 0;
        for (const item of r.itens) {
          for (const d of a.normalizer(item)) {
            out.push(finding('resultado', `${a.name} · ${d.rotulo}`, d.valor, [src(a)], { kind: 'fact', confidence: 'indicated' }));
            n++;
          }
        }
        if (!n) notes.push(`${a.name}: run sem itens normalizáveis.`);
      } else if (r.status === 'ERROR') {
        log.error(src(a), a.name, `https://apify.com/${a.actorId}`, limpar(r.nota, token().token), r.ms);
        out.push(finding('actor', a.name, `ERROR — ${limpar(r.nota, token().token)}`, [src(a)], { kind: 'fact', confidence: 'confirmed' }));
        notes.push(`${a.name}: ${limpar(r.nota, token().token)}`);
      } else {
        log.skipped(src(a), a.name, `https://apify.com/${a.actorId}`, `${r.status} — ${r.nota}`);
        out.push(finding('actor', a.name, `${r.status} — ${r.nota}`, [src(a)], { kind: 'fact', confidence: 'confirmed' }));
        notes.push(`${a.name}: ${r.status} — ${r.nota}`);
      }
    }

    out.push(finding('resumo', 'Actors prontos', contas.READY, ['apify'], { kind: 'fact', confidence: 'confirmed' }));
    const semExecutar = escolhidos.length - contas.READY;
    if (semExecutar) out.push(finding('resumo', 'Actors sem executar', semExecutar, ['apify'], { kind: 'fact', confidence: 'confirmed' }));
    if (contas.AGUARDA_CONFIRMACAO) {
      notes.push('Confirme o custo (confirmarCusto=sim) para executar: os actors do Apify são pagos por evento.');
    }
    return { findings: out, log, notes };
  },
});

export { saude as saudeApify, ACTORS as ACTORS_APIFY };
