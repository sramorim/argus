/**
 * Testes do Intelligence Engine (sem rede).
 *   node test/intel.test.ts
 *
 * Lógica pura: entity resolution, confidence, correlações, diff de snapshots,
 * radar, timeline, relações e os quatro formatos de relatório. O que se protege
 * aqui é a parte que não se vê a correr contra alvos — sobretudo as recusas:
 * sem evidência não há confiança, sem anterior não há radar, sem data não há
 * ordem inventada.
 */
import { pontuar, LIMIARES, comoFrase } from '../src/intel/confidence.ts';
import { normalizar, tokens, similaridade, mesmoIndicador, comparar, resolver } from '../src/intel/entities.ts';
import { correlacionar, indicadores, biosParecidas, confiancaMaxima } from '../src/intel/correlation.ts';
import { unificar, resumoPerfil } from '../src/intel/unified.ts';
import { cruzar, identificadorDominante } from '../src/intel/cross-platform.ts';
import { diff, resumoDiff, soAlteracoes } from '../src/intel/diff.ts';
import { capturar, normalizar as normDoc, presencaDe } from '../src/intel/snapshots.ts';
import { radar, categoriaDe } from '../src/intel/radar.ts';
import { linhaTempo, dataValida, porJanela } from '../src/intel/timeline.ts';
import { historico, diasConsecutivos } from '../src/intel/activity-history.ts';
import { relacionar, resumoRelacoes } from '../src/intel/relationships.ts';
import { gerarRelatorio, linhas, FORMATOS } from '../src/intel/reports.ts';
import { pdfValido } from '../src/intel/pdf.ts';
import type { Entidade, Evidencia, Evento } from '../src/intel/types.ts';

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string, extra = '') {
  if (cond) { pass++; console.log(`\x1b[32m✓\x1b[0m ${msg}`); }
  else { fail++; console.log(`\x1b[31m✗\x1b[0m ${msg} ${extra}`); }
}

const ev = (provider: string, nota: string): Evidencia => ({
  fonte: provider, url: 'https://exemplo.test/x', provider, timestamp: '2026-01-01T00:00:00.000Z', nota,
});

const ent = (p: Partial<Entidade> & { id: string }): Entidade => ({
  rotulo: p.id, tipo: 'conta', provider: 'teste', plataformas: [], atributos: {}, evidencias: [], ...p,
});

// ------------------------------------------------------------- confidence
const pAlta = pontuar(
  [{ nome: 'sinal', peso: 8, explica: 'a' }, { nome: 'outro', peso: 6, explica: 'b' }],
  [ev('f1', 'x'), ev('f2', 'y')],
);
ok(pAlta.confianca === 'HIGH' && pAlta.total === 14, 'confiança alta: score alto com duas origens', `${pAlta.confianca}/${pAlta.total}`);
ok(pAlta.explicacao.includes('sinal (+8)') && pAlta.explicacao.includes('outro (+6)'), 'fatores explicados com peso');

const umaOrigem = pontuar([{ nome: 'sinal', peso: 20, explica: 'a' }], [ev('f1', 'x')]);
ok(umaOrigem.confianca !== 'HIGH', 'sem segunda origem não há faixa alta', umaOrigem.confianca);
ok(umaOrigem.explicacao.includes('segunda origem'), 'a razão fica escrita', umaOrigem.explicacao);

const semEv = pontuar([{ nome: 'sinal', peso: 20, explica: 'a' }], []);
ok(semEv.confianca === 'UNCONFIRMED' && semEv.explicacao.includes('sem evidência declarada'),
  'score alto sem evidência = UNCONFIRMED (o nosso código não é fonte)', semEv.confianca);

ok(pontuar([], []).confianca === 'UNCONFIRMED', 'sem fatores = UNCONFIRMED');
ok(pontuar([{ nome: 'fraco', peso: 4, explica: 'a' }], [ev('f1', 'x')]).confianca === 'LOW',
  'score moderado com origem = LOW');
ok(pontuar([{ nome: 'fraco', peso: 1, explica: 'a' }], [ev('f1', 'x')]).confianca === 'UNCONFIRMED',
  'score abaixo do limiar de LOW = UNCONFIRMED');
ok(LIMIARES.HIGH > LIMIARES.MEDIUM && LIMIARES.MEDIUM > LIMIARES.LOW, 'limiares coerentes');
ok(comoFrase('UNCONFIRMED', 'par').includes('sem evidência suficiente'), 'frase honesta para UNCONFIRMED');

// --------------------------------------------------------------- entities
ok(normalizar('  ÁNDRÉ-Costa ') === 'andre-costa', 'normalizar remove acentos e caixa');
ok(tokens('o gato e o rato').size === 2, 'tokens ignoram palavras curtas', String(tokens('o gato e o rato').size));
ok(similaridade('fotografia e viajar', 'gostar de viajar e fotografar') >= 0.2, 'similaridade de bio sensata',
  String(similaridade('fotografia e viajar', 'gostar de viajar e fotografar')));
ok(similaridade('abc', 'xyz') === 0, 'textos sem sobreposição = 0');
ok(mesmoIndicador('Ana', 'ana') && !mesmoIndicador('ana', 'ana2'), 'mesmoIndicador compara normalizado');
ok(!mesmoIndicador('', ''), 'indicador vazio nunca casa');

const a = ent({
  id: 'e1', rotulo: 'Instagram @ana', provider: 'instagram-osint', plataformas: ['instagram'],
  atributos: { username: 'ana', nome: 'Ana Souza', bio: 'gosto de viajar e fotografar', url: 'https://instagram.com/ana' },
  evidencias: [ev('instagram-osint', 'perfil público')],
});
const b = ent({
  id: 'e2', rotulo: 'TikTok @ana', provider: 'social-search', plataformas: ['tiktok'],
  atributos: { username: 'ana', nome: 'Ana Souza', bio: 'gosto de viajar e fotografar', url: 'https://tiktok.com/@ana' },
  evidencias: [ev('social-search', 'perfil público')],
});
const r = comparar(a, b);
ok(r.confianca === 'HIGH' && r.total >= LIMIARES.HIGH, 'par com identificador+nome+bio iguais = HIGH', `${r.confianca}/${r.total}`);
ok(r.fatores.some((f) => f.nome === 'identificador igual') && r.fatores.some((f) => f.nome === 'bio parecida'),
  'fatores presentes e nomeados');
ok(!/é a mesma pessoa/i.test(r.nota), 'a nota nunca afirma identidade', r.nota);
ok(r.evidencias.length >= 2, 'resolução com evidências das duas origens', String(r.evidencias.length));

const c = ent({ id: 'e3', rotulo: 'outro', provider: 'x', atributos: { username: 'zed' }, evidencias: [ev('x', 'y')] });
ok(comparar(a, c).confianca === 'UNCONFIRMED', 'sem sinal comum = UNCONFIRMED', comparar(a, c).confianca);
ok(resolver([a, b, c]).length >= 1, 'resolver devolve pares acima do limiar');
ok(resolver([a, c]).length === 0, 'par sem sinal não é devolvido como resolução');

const semFonte = { ...a, evidencias: [] as Evidencia[] };
ok(comparar(semFonte, b).confianca !== 'HIGH',
  'entidade sem observação declarada não chega a HIGH', comparar(semFonte, b).confianca);
ok(comparar({ ...a, evidencias: [] }, { ...b, evidencias: [] }).confianca === 'UNCONFIRMED',
  'duas entidades sem fontes = UNCONFIRMED, mesmo com sinais iguais');

// ------------------------------------------------------------ correlation
const inds = indicadores(a);
ok(inds.some((i) => i.tipo === 'username') && inds.some((i) => i.tipo === 'url') && inds.some((i) => i.tipo === 'nome'),
  'indicadores extraídos dos atributos');
const cs = correlacionar([a, b]);
ok(cs.length >= 1, 'correlação com valor repetido');
ok(cs.every((x) => x.evidencias.length > 0), 'toda correlação tem evidência');
ok(cs.some((x) => x.tipo === 'username' && x.valor === 'ana'), 'username repetido correlacionado');
ok(correlacionar([a]).length === 0, 'uma só entidade não gera correlação');
ok(correlacionar([a, b])[0].nota.includes('não afirma') || correlacionar([a, b])[0].nota.includes('nao afirma'),
  'nota da correlação recusa a conclusão de identidade');
const semFontes = correlacionar([{ ...a, evidencias: [] }, { ...b, evidencias: [] }]);
ok(semFontes.every((x) => x.confianca === 'UNCONFIRMED'), 'correlação sem fontes = UNCONFIRMED');
ok(biosParecidas([a, b]).length === 1, 'bios parecidas geram correlação própria');
ok(confiancaMaxima([{ confianca: 'LOW' }, { confianca: 'HIGH' }]) === 'HIGH', 'confiança máxima do conjunto');
ok(confiancaMaxima([]) === 'UNCONFIRMED', 'conjunto vazio = UNCONFIRMED');

// --------------------------------------------------------------- unified
const perfil = unificar([a, b], cs, resolver([a, b]));
ok(perfil.entidades.length === 2 && perfil.rotulo.includes('Instagram'), 'perfil une as entidades', perfil.rotulo);
ok(perfil.contas.length === 2, 'uma conta por plataforma', String(perfil.contas.length));
ok(perfil.identificadores.some((i) => i.tipo === 'username' && i.valor === 'ana'), 'identificador comum listado');
ok(perfil.lacunas.some((l) => l.includes('email')), 'falta de email é lacuna, não omissão');
ok(perfil.evidencias.length >= 2, 'perfil carrega evidências');
ok(perfil.confiancaGeral === 'HIGH', 'confiança geral herda da melhor resolução', perfil.confiancaGeral);
ok(resumoPerfil(perfil).includes('entidade'), 'resumo de uma linha');
ok(typeof perfil.geradoEm === 'string' && perfil.geradoEm.length > 10, 'perfil datado');

const divergente = unificar([a, { ...b, atributos: { ...b.atributos, nome: 'Ana Maria' } }], [], []);
ok(divergente.lacunas.some((l) => l.includes('divergência')), 'divergência fica escrita, não é silenciosamente resolvida',
  JSON.stringify(divergente.lacunas));

// ---------------------------------------------------------- cross-platform
ok(identificadorDominante([a, b]) === 'ana', 'identificador dominante');
const cx = cruzar([a, b]);
ok(cx.totalPlataformas === 2 && cx.iguais === 2, 'duas plataformas com o mesmo identificador', `${cx.totalPlataformas}/${cx.iguais}`);
ok(cx.nota.includes('NÃO prova') || cx.nota.includes('NAO prova'), 'cruzamento recusa a conclusão de identidade', cx.nota);
ok(cx.confianca !== 'HIGH', 'cruzamento de username nunca é HIGH (usernames são reutilizáveis)', cx.confianca);
ok(cruzar([c]).totalPlataformas === 0, 'sem plataforma = nada a cruzar');

// ------------------------------------------------------------------ diff
const d1 = diff({ a: 1, l: ['x', 'y'] }, { a: 1, l: ['x', 'y'] });
ok(resumoDiff(d1).alteracoes === 0, 'documentos iguais = zero alterações');
const d2 = diff({ a: 1, bio: 'olá' }, { a: 2, bio: 'adeus', novo: true });
const r2 = resumoDiff(d2);
ok(r2.CHANGED === 2 && r2.NEW === 1, 'mudanças e chaves novas contadas', JSON.stringify(r2));
const d3 = diff({ l: ['x', 'y'] }, { l: ['y', 'x'] });
ok(resumoDiff(d3).alteracoes === 0, 'lista que muda de ordem não é alteração');
const d4 = diff({ l: ['x', 'y'] }, { l: ['y', 'z'] });
ok(resumoDiff(d4).NEW === 1 && resumoDiff(d4).REMOVED === 1, 'listas comparam por conjunto');
ok(resumoDiff(diff({ a: 1 }, { a: 1 })).UNCHANGED === 1, 'UNCHANGED registado');
ok(soAlteracoes(d2).every((x) => x.estado !== 'UNCHANGED'), 'soAlteracoes filtra o que não mudou');
ok(diff({ a: 1 }, { a: 1 })[0].caminho === 'a', 'caminho completo do diff');

// ----------------------------------------------------------------- radar
const pres1 = presencaDe(perfil);
const snap1 = capturar('ana', pres1, '2026-01-01T00:00:00.000Z');
const pres2 = { ...pres1, plataformas: [...pres1.plataformas, 'reddit'].sort(), bio: 'nova bio', links: [...pres1.links, 'https://novo.test'] };
const snap2 = capturar('ana', pres2, '2026-02-01T00:00:00.000Z');

const rSem = radar(null, snap2);
ok(rSem.temAnterior === false && rSem.detetados.length === 0, 'sem snapshot anterior não há radar');
ok(rSem.nota.includes('Primeira observação'), 'a primeira captura diz o que é', rSem.nota);

const rCom = radar(snap1, snap2);
ok(rCom.temAnterior && rCom.detetados.length >= 2, 'radar deteta mudanças', String(rCom.detetados.length));
ok(rCom.detetados.some((d) => d.categoria === 'plataforma' && d.estado === 'NEW'), 'nova plataforma detetada');
ok(rCom.detetados.some((d) => d.categoria === 'bio' && d.estado === 'CHANGED'), 'mudança de bio detetada');
ok(rCom.detetados.some((d) => d.categoria === 'link' && d.estado === 'NEW'), 'link novo detetado');
ok(rCom.nota.includes('não é monitorização') || rCom.nota.includes('nao e monitorizacao'), 'nota recusa vigilância', rCom.nota);
ok(radar(snap1, snap1).detetados.length === 0, 'snapshot idêntico = nada detetado');
ok(categoriaDe('plataformas[reddit]') === 'plataforma' && categoriaDe('bio') === 'bio' && categoriaDe('outro.caminho') === 'outro',
  'caminhos do diff viram categorias do radar');

// --------------------------------------------------------------- timeline
const eventos: Evento[] = [
  { quando: '2026-03-01T10:00:00.000Z', tipo: 'post', descricao: 'terceiro', plataforma: 'x' },
  { quando: '2026-01-01T10:00:00.000Z', tipo: 'post', descricao: 'primeiro', plataforma: 'instagram' },
  { quando: '2026-01-02T10:00:00.000Z', tipo: 'comentario', descricao: 'segundo' },
  { quando: 'data-invalida', tipo: 'post', descricao: 'sem data' },
  { quando: '', tipo: 'post', descricao: 'sem quando' },
];
const lt = linhaTempo(eventos);
ok(lt.eventos.length === 3, 'só eventos com data válida entram na ordem', String(lt.eventos.length));
ok(lt.eventos[0].descricao === 'primeiro' && lt.eventos[2].descricao === 'terceiro', 'ordenados cronologicamente');
ok(lt.invalidos + lt.semData === 2, 'os dois sem data válida são contados, não inventados', `${lt.invalidos}/${lt.semData}`);
ok(lt.intervalos.length === 1 && lt.intervalos[0].dias > 50, 'intervalo longo assinalado', JSON.stringify(lt.intervalos[0]));
ok(lt.intervalos[0].nota.includes('não se conclui'), 'o intervalo não é apresentado como inatividade');
ok(dataValida('2026-01-01') && !dataValida('1800-01-01') && !dataValida(''), 'validação de datas');
ok(porJanela(eventos).length >= 2, 'agregação por janela');
ok(linhaTempo([]).primeiro === null, 'timeline vazia não é erro');

// -------------------------------------------------------- activity history
const h = historico(eventos);
ok(h.total === 5 && h.comData === 3 && h.semData === 2, 'histórico com denominador explícito', `${h.comData}/${h.total}`);
ok(h.porPlataforma.some((p) => p.plataforma === 'instagram' && p.total === 1), 'agregado por plataforma');
ok(h.porDia.length === 3, 'agregado por dia');
ok(h.pico !== null && h.pico.total >= 1, 'pico calculado');
ok(h.duracaoDias !== null && h.duracaoDias > 50, 'duração observada', String(h.duracaoDias));
ok(diasConsecutivos(h).length >= 1, 'dias consecutivos calculados');
ok(historico([]).pico === null, 'histórico vazio não é erro');

// ----------------------------------------------------------- relationships
const rel = relacionar([a, b], cs);
ok(rel.length >= 1, 'relações derivadas das correlações');
ok(rel.every((x) => x.evidencias.length > 0), 'toda relação tem evidência');
ok(rel.some((x) => x.tipo === 'mesmo-indicador'), 'relação de indicador partilhado');
const comSegue = relacionar([{ ...a, atributos: { ...a.atributos, segue: 'e2' } }, b], []);
ok(comSegue.some((x) => x.tipo === 'segue' && x.de === 'e1' && x.para === 'e2'), 'declaração explícita da fonte vira aresta');
ok(relacionar([{ ...a, atributos: { ...a.atributos, segue: 'inexistente' } }], []).length === 0,
  'declaração para destino fora do grafo não cria aresta solta');
ok(comSegue.every((x) => x.evidencias.length > 0), 'declaração também com evidência');
ok(resumoRelacoes(rel).length >= 1, 'resumo por tipo de relação');

// ---------------------------------------------------------------- reports
const pedido = { alvo: 'ana', perfil, radar: rCom, formato: 'json' as const };
const j = gerarRelatorio(pedido);
ok(j.mime === 'application/json', 'JSON mime');
const parsed = JSON.parse(String(j.conteudo)) as { resumo: { entidades: number }; nota: string };
ok(parsed.resumo.entidades === 2 && parsed.nota.length > 20, 'JSON válido com resumo e nota');

const cCSV = gerarRelatorio({ alvo: 'ana', perfil, formato: 'csv' });
const csvTxt = String(cCSV.conteudo);
ok(csvTxt.startsWith('﻿secção,tipo,valor'), 'CSV com cabeçalho e BOM');
ok(csvTxt.split('\n').length > 5, 'CSV com linhas');
ok(gerarRelatorio({ alvo: 'a,b"c', perfil, formato: 'csv' }).mime.includes('csv'), 'CSV com alvo difícil não parte');

const comScript = unificar([{ ...a, atributos: { ...a.atributos, bio: '<script>alert(1)</script>' } }], [], []);
const hHTML = gerarRelatorio({ alvo: '<img onerror=1>', perfil: comScript, formato: 'html' });
const htmlTxt = String(hHTML.conteudo);
ok(!htmlTxt.includes('<script>alert'), 'HTML escapado: o que o utilizador escreve é texto', htmlTxt.slice(0, 400));
ok(htmlTxt.includes('&lt;script&gt;'), 'escape de <script> presente');
ok(htmlTxt.includes('<!doctype html>') && htmlTxt.includes('</html>'), 'HTML completo');
ok(!/src="http|href="http|url\(http/.test(htmlTxt), 'HTML autossuficiente, sem recursos externos');

const pdf = gerarRelatorio({ alvo: 'ana', perfil, formato: 'pdf' });
const bytes = pdf.conteudo as Uint8Array;
ok(bytes instanceof Uint8Array && bytes.length > 500, 'PDF é bytes', String(bytes.length));
const v = pdfValido(bytes);
ok(v.ok && v.paginas >= 1, 'PDF válido', `${v.ok} ${v.motivo} ${v.paginas}`);

ok(FORMATOS.join(',') === 'json,csv,html,pdf', 'quatro formatos');
ok(linhas(pedido).some((l) => l.seccao === 'Correlações') && linhas(pedido).some((l) => l.seccao === 'Radar'),
  'mesmas secções para todos os formatos');
ok(linhas(pedido).every((l) => typeof l.valor === 'string'), 'linhas coerentes');

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
