/** Exposição pública: pastes, código indexado e breaches (só com chave BYOK). */
import { registerTool } from '../registry.ts';
import { SourceLog, finding, type Finding } from '../net/provenance.ts';
import { apiGet } from '../net/ssrf.ts';
import { bingRss } from '../net/sources.ts';

// ---------------- EXPOSIÇÃO PÚBLICA (paste + código + breaches por BYOK) ----------------
registerTool({
  id: 'paste-search',
  name: 'Exposição Pública',
  category: 'ameaca',
  summary: 'Procura o alvo em sites de paste, GitHub e código indexado, executando a busca real — e consulta breaches se tiver uma chave Leak-Lookup.',
  longDesc: 'Gera dorks de exposição (sites de paste, código no GitHub/GitLab, segredos) e executa a pesquisa real, devolvendo os resultados com título, URL e excerto. Se tiver uma chave Leak-Lookup (BYOK), acrescenta a consulta a bases de brechas por email ou username. Sem chave, a parte de breach aparece honestamente como "precisa de chave" em vez de fingir resultados.',
  minPlan: 'pro',
  freeTier: false,
  legalGate: 'lgpd',
  tags: ['paste', 'segredos', 'github', 'dorks', 'exposicao', 'breach'],
  fields: [
    { name: 'term', label: 'Email, dominio, username ou telefone', type: 'text', required: true, placeholder: 'exemplo.com' },
    { name: 'exec', label: 'Executar a busca real?', type: 'text', required: false, placeholder: 'sim / nao', hint: 'Recomendado: sim. Sem isto só devolve os dorks.' },
  ],
  async run(input, ctx) {
    const term = String(input.term ?? '').trim();
    const execRaw = String(input.exec ?? '').trim().toLowerCase();
    const exec = execRaw === '' ? true : !/^(nao|no|false|0)$/.test(execRaw);
    const log = new SourceLog();
    const out: Finding[] = [];
    if (!term) {
      log.empty('validacao', 'Alvo', '(vazio)', 0, 'sem termo');
      out.push(finding('validacao', 'Alvo', 'vazio', [], { confidence: 'weak' }));
      return { findings: out, log };
    }
    const esc = term.replace(/"/g, '');
    const isEmail = /^[^@\s]+@[^@\s]+$/.test(term);
    log.local(0, 'Composicao dos dorks (sem pedido a nenhuma fonte)');

    const dorks = [
      { onde: 'Sites de paste', query: `"${esc}" (site:pastebin.com OR site:paste.ee OR site:hastebin.com OR site:ghostbin.com OR site:rentry.co OR site:pastebin.pl)` },
      { onde: 'GitHub / GitLab', query: `"${esc}" (site:github.com OR site:gitlab.com OR site:bitbucket.org)` },
      { onde: 'Segredos em código', query: `"${esc}" (password OR secret OR api_key OR token) -site:github.com` },
      { onde: 'Web geral', query: `"${esc}"` },
    ];
    out.push(finding('alvo', 'Alvo pesquisado', term, [], { confidence: 'confirmed' }));
    out.push(finding('dorks', 'Consultas prontas', dorks.map((d) => ({ onde: d.onde, consulta: d.query })), [], { kind: 'claim', confidence: 'confirmed' }));
    for (const d of dorks) {
      out.push(finding('dorks', `Abrir: ${d.onde}`, `https://www.bing.com/search?q=${encodeURIComponent(d.query)}`, [],
        { kind: 'claim', link: `https://www.bing.com/search?q=${encodeURIComponent(d.query)}` }));
    }

    if (exec) {
      // Duas buscas independentes em paralelo (paste e código).
      const [hitsPaste, hitsCode] = await Promise.all([
        bingRss(dorks[0]!.query, log, 'bing'),
        bingRss(dorks[1]!.query, log, 'bing-codigo'),
      ]);
      const todos = [...hitsPaste, ...hitsCode];
      const vistos = new Set<string>();
      const unicos = todos.filter((h) => !vistos.has(h.url) && vistos.add(h.url));
      if (unicos.length) {
        out.push(finding('resultados', `Resultados reais (${unicos.length})`,
          unicos.slice(0, 25).map((h) => ({ titulo: h.titulo, url: h.url, excerto: h.descricao })),
          ['bing', 'bing-codigo'], { confidence: 'corroborated' }));
      } else {
        log.note('A pesquisa executou e não devolveu resultados. Isto é um resultado legítimo: o alvo pode não estar exposto.');
        out.push(finding('resultados', 'Resultados', 'Nenhum resultado nas pesquisas executadas. Isto é um dado, não um erro.', [], { kind: 'fact', confidence: 'confirmed' }));
      }
    } else {
      log.skipped('bing', 'Busca real', 'bing', 'a busca nao foi executada (resposta "nao" no campo "Executar a busca real?")');
    }

    // Breach por BYOK — a parte que precisa de chave do utilizador.
    // A chave do Leak-Lookup é do dono do serviço, não do utilizador que
    // pesquisa: uma variável no ambiente do servidor. Sem ela, a parte de
    // brechas é omitida e as de paste/código continuam a correr.
    const key = (process.env.LEAKLOOKUP_API_KEY ?? '').trim();
    if (key) {
      const type = isEmail ? 'email_address' : 'username';
      const url = `https://leak-lookup.com/api/search?key=${encodeURIComponent(key)}&type=${type}&query=${encodeURIComponent(term)}`;
      try {
        const r = await apiGet(url, { timeoutMs: 12_000 });
        if (r.status === 200) {
          const j = JSON.parse(r.body) as { error?: string; message?: { name?: string; data?: unknown[] }[] };
          if (!j.error && Array.isArray(j.message)) {
            log.ok('leaklookup', 'Leak-Lookup (a sua chave)', 'leak-lookup.com', r.ms, j.message.length);
            out.push(finding('breach', 'Entradas em bases de brechas', j.message.length, ['leaklookup'], { confidence: 'corroborated' }));
            for (const e of j.message.slice(0, 20)) {
              out.push(finding('breach', e.name ?? 'Entrada', Array.isArray(e.data) ? (e.data as unknown[]).slice(0, 6).join(' | ') : String(e.data ?? '').slice(0, 200), ['leaklookup'], { confidence: 'corroborated' }));
            }
          } else {
            log.error('leaklookup', 'Leak-Lookup', 'leak-lookup.com', String(j.error).slice(0, 60));
          }
        } else log.error('leaklookup', 'Leak-Lookup', 'leak-lookup.com', `HTTP ${r.status}`);
      } catch (e) { log.error('leaklookup', 'Leak-Lookup', url, String((e as Error).message).slice(0, 60)); }
    } else {
      log.needsKey('leaklookup', 'Leak-Lookup (breaches por email/username)', 'https://leak-lookup.com/api', 'A única base de brechas com API gratuitamente acessível exige registo. Com a sua chave, esta ferramenta também devolve as entradas encontradas.');
    }
    return { findings: out, log, notes: ['Vazamentos são dados sensíveis. Use apenas para fins legítimos e defensivos.'] };
  },
});
