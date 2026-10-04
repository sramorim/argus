/**
 * OSINT Engine — a porta única para as cinco ferramentas de terceiros do escopo:
 * SpiderFoot, Photon, OpenOSINT, GHunt e Holehe.
 *
 * O que este módulo faz é deliberadamente pequeno:
 *
 *   1. decide o tipo de alvo (email / domínio / IP / username) e quem dele aceita;
 *   2. diz o que falta ANTES de correr qualquer coisa — `NOT_INSTALLED` com o
 *      comando de instalação, `NOT_CONFIGURED` com o nome EXATO da variável;
 *   3. executa pelo runner isolado (`providers/runtime.ts`: sem shell, env mínima,
 *      tempo e saída limitados);
 *   4. devolve a saída como evidência, com fonte e timestamp.
 *
 * Nada é fabricado. Se a saída não for interpretável, o estado é `ERROR` com a
 * razão — nunca "encontrámos isto" a partir de texto que não se entendeu. Se o
 * programa não está instalado, o estado é `NOT_INSTALLED`: cinco providers fora
 * é um resultado legítimo, não uma falha do ARGOS.
 */
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerTool } from '../registry.ts';
import { SourceLog, finding, type Finding } from '../net/provenance.ts';
import { executarCli, existe, lerESair } from '../providers/runtime.ts';
import {
  PROVIDERS, TIPOS_DE_ALVO, classificar, detectarTipo, planejar,
  type EstadoProvider, type ProviderOsint, type TipoAlvo,
} from '../providers/osint.ts';

const src = (p: ProviderOsint) => `p-osint-${p.id}`;

function escolher(bruto: string): ProviderOsint[] {
  const limpo = String(bruto ?? '').trim();
  if (!limpo) return PROVIDERS;
  const ids = limpo.toLowerCase().split(/[,\s]+/).filter(Boolean);
  const validos = PROVIDERS.filter((p) => ids.includes(p.id));
  return validos.length ? validos : PROVIDERS;
}

registerTool({
  id: 'osint-engine',
  name: 'OSINT Engine',
  category: 'pessoa',
  summary: 'SpiderFoot, Photon, OpenOSINT, GHunt e Holehe como providers independentes, executados isoladamente.',
  longDesc: 'Cada ferramenta de terceiros corre como processo isolado (sem shell, ambiente mínima, tempo e saída limitados) e reporta o estado real: READY com a saída como evidência, NOT_INSTALLED com o comando de instalação, NOT_CONFIGURED com o nome da variável em falta, INCOMPATIBLE quando o alvo não é do tipo que ela aceita, ERROR com o stderr. Nenhum resultado é fabricado. Licenças: SpiderFoot e OpenOSINT MIT, Photon e Holehe GPL-3.0, GHunt AGPL-3.0 — executados como processo separado, nunca importados.',
  minPlan: 'free',
  freeTier: true,
  legalGate: 'lgpd',
  tags: ['osint', 'spiderfoot', 'photon', 'ghunt', 'holehe', 'email', 'dominio'],
  fields: [
    { name: 'alvo', label: 'Alvo', type: 'text', placeholder: 'ex: exemplo.com | pessoa@exemplo.com | alvo_demo', required: true, hint: 'Domínio, IP, email ou username — o tipo é detetado, pode forçar no campo seguinte.' },
    { name: 'tipo', label: 'Tipo de alvo', type: 'text', placeholder: 'auto | email | dominio | ip | username', required: false, hint: 'Por omissão, deteção automática.' },
    { name: 'providers', label: 'Providers', type: 'text', placeholder: 'spiderfoot, photon, openosint, ghunt, holehe', required: false, hint: 'Por omissão, os cinco.' },
  ],
  async run(input) {
    const alvo = String(input.alvo ?? '').trim();
    const log = new SourceLog();
    const out: Finding[] = [];
    const contas: Record<EstadoProvider, number> = { READY: 0, NOT_INSTALLED: 0, NOT_CONFIGURED: 0, INCOMPATIBLE: 0, ERROR: 0 };
    const notas: string[] = [];

    if (!alvo || alvo.length > 254 || /[\s<>"]/.test(alvo)) {
      out.push(finding('validacao', 'Alvo', alvo ? `inválido: "${alvo.slice(0, 80)}"` : 'em falta',
        [], { kind: 'claim', confidence: 'confirmed' }));
      notas.push('O alvo não pode ter espaços, aspas ou mais de 254 caracteres.');
      return { findings: out, log, notes: notas };
    }

    const tipoRaw = String(input.tipo ?? '').trim().toLowerCase() as TipoAlvo | '' | 'auto';
    const tipo: TipoAlvo = tipoRaw && tipoRaw !== 'auto' && TIPOS_DE_ALVO.has(tipoRaw) ? tipoRaw : detectarTipo(alvo);
    const escolhidos = escolher(input.providers);
    const tmp = join(tmpdir(), `argus-osint-${randomBytes(6).toString('hex')}.json`);

    out.push(finding('alvo', 'Alvo', alvo, [], { kind: 'fact', confidence: 'confirmed' }));
    out.push(finding('alvo', 'Tipo detetado', tipo, [], { kind: 'claim', confidence: 'indicated' }));

    for (const p of escolhidos) {
      const planejo = planejar(p, alvo, tipo, tmp);

      if (planejo.estado === 'INCOMPATIBLE') {
        contas.INCOMPATIBLE++;
        log.skipped(src(p), p.nome, p.repo, planejo.nota);
        out.push(finding('provider', p.nome, `INCOMPATIBLE — ${planejo.nota}`, [src(p)], { kind: 'fact', confidence: 'confirmed' }));
        continue;
      }
      if (planejo.estado === 'NOT_CONFIGURED') {
        contas.NOT_CONFIGURED++;
        log.skipped(src(p), p.nome, p.repo, planejo.nota);
        out.push(finding('provider', p.nome, `NOT_CONFIGURED — ${planejo.nota}`, [src(p)], { kind: 'fact', confidence: 'confirmed' }));
        notas.push(`${p.nome}: ${planejo.nota}`);
        continue;
      }

      const binOk = await existe(planejo.executavel);
      const scriptOk = p.python ? await existe(planejo.args[0] ?? '') : true;
      if (!binOk || !scriptOk) {
        const falta = !binOk ? planejo.executavel : planejo.args[0] ?? '';
        const nota = p.binario
          ? `${falta} não está no PATH (instale: ${p.instalacao})`
          : `caminho não encontrado: ${falta}`;
        contas.NOT_INSTALLED++;
        log.skipped(src(p), p.nome, p.repo, nota);
        out.push(finding('provider', p.nome, `NOT_INSTALLED — ${nota}`, [src(p)], { kind: 'fact', confidence: 'confirmed' }));
        notas.push(`${p.nome}: ${nota}`);
        continue;
      }

      const t0 = Date.now();
      const saida = await executarCli({ executavel: planejo.executavel, args: planejo.args });
      let textoExtra: string | undefined;
      if (p.id === 'ghunt') {
        const f = await lerESair(tmp, 800_000);
        if (f) textoExtra = f.texto;
      }
      const r = classificar(p, saida, textoExtra);
      const ms = Date.now() - t0;
      contas[r.estado]++;

      if (r.estado === 'READY') {
        log.ok(src(p), p.nome, p.repo, ms, r.itens.length, r.nota || undefined);
        out.push(finding('provider', p.nome, `READY — ${r.itens.length} registo(s)${r.nota ? ` · ${r.nota}` : ''}`, [src(p)], { kind: 'fact', confidence: 'indicated' }));
        for (const it of r.itens) {
          out.push(finding('resultado', `${p.nome} · ${it.rotulo}`, it.valor, [src(p)], { kind: 'fact', confidence: 'indicated' }));
        }
      } else if (r.estado === 'ERROR') {
        log.error(src(p), p.nome, p.repo, r.nota, ms);
        out.push(finding('provider', p.nome, `ERROR — ${r.nota}`, [src(p)], { kind: 'fact', confidence: 'confirmed' }));
        notas.push(`${p.nome}: ${r.nota}`);
      } else {
        log.skipped(src(p), p.nome, p.repo, `${r.estado} — ${r.nota}`);
        out.push(finding('provider', p.nome, `${r.estado} — ${r.nota}`, [src(p)], { kind: 'fact', confidence: 'confirmed' }));
        notas.push(`${p.nome}: ${r.estado} — ${r.nota}`);
      }
    }

    out.push(finding('resumo', 'Providers READY', contas.READY, [src(escolhidos[0])], { kind: 'fact', confidence: 'confirmed' }));
    const fora = contas.NOT_INSTALLED + contas.NOT_CONFIGURED + contas.INCOMPATIBLE + contas.ERROR;
    if (fora) {
      out.push(finding('resumo', 'Providers sem executar', fora, [src(escolhidos[0])], { kind: 'fact', confidence: 'confirmed' }));
    }
    if (!contas.READY) {
      notas.push('Nenhum provider executou devido ao estado real das dependências — nada foi simulado.');
    }
    return { findings: out, log, notes: notas };
  },
});
