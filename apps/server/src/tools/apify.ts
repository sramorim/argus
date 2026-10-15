/**
 * Ferramentas OSINT via Apify — Instagram, TikTok, Facebook e X (Twitter).
 *
 * Cada ferramenta é Pro: custa créditos na conta Apify do ARGOS (pay-per-event).
 * O engine está em `../net/apify.ts` — aqui só se registam as ferramentas no
 * catálogo do ARGOS e se mapeiam os resultados para findings.
 *
 * Regras:
 *  - O token NUNCA aparece nos findings. O engine já garante isso.
 *  - Sem token → a ferramenta diz "APIFY não configurado" e não finge que procura.
 *  - Os dados devolvidos pelo actor são TODOS mostrados, sem filtro artificial.
 *  - Actors de terceiros (não `apify/*`) têm nota explícita.
 *  - O `viaApiNaFree: false` do Tweet Scraper é respeitado com nota.
 */
import { registerTool } from '../registry.ts';
import { SourceLog, finding, type Finding } from '../net/provenance.ts';
import { escolherActors, correr, token, type ActorDef } from '../net/apify.ts';

// ============================================================ helpers

/** Extrai foto de perfil de um item do Apify (vários nomes possíveis). */
function fotoDoItem(item: unknown): string | null {
  if (!item || typeof item !== 'object') return null;
  const obj = item as Record<string, unknown>;
  for (const k of ['profilePicUrl', 'profile_pic_url', 'profilePicUrlHD', 'avatar', 'avatarUrl', 'userPic']) {
    const v = obj[k];
    if (typeof v === 'string' && v.startsWith('http')) return v;
  }
  return null;
}

/** Extrai username de um item do Apify. */
function usernameDoItem(item: unknown): string {
  if (!item || typeof item !== 'object') return '';
  const obj = item as Record<string, unknown>;
  for (const k of ['username', 'userName', 'user_name', 'ownerUsername', 'authorMeta']) {
    const v = obj[k];
    if (typeof v === 'string' && v) return v;
    if (typeof v === 'object' && v && 'name' in (v as Record<string, unknown>)) return String((v as Record<string, unknown>).name);
  }
  return '';
}

/** Extrai nome completo de um item do Apify. */
function nomeDoItem(item: unknown): string | null {
  if (!item || typeof item !== 'object') return null;
  const obj = item as Record<string, unknown>;
  for (const k of ['fullName', 'full_name', 'name', 'displayName', 'nickname']) {
    const v = obj[k];
    if (typeof v === 'string' && v) return v;
  }
  return null;
}

/**
 * Corre um ou mais actors de uma plataforma e devolve findings + log.
 * Escolhe o actor de perfil primeiro; se houver mais, corre todos.
 */
async function correrPlataforma(
  plataforma: string,
  alvo: string,
  actorIds?: string[],
): Promise<{ findings: Finding[]; log: SourceLog; notes: string[] }> {
  const log = new SourceLog();
  const out: Finding[] = [];
  const notes: string[] = [];

  const tk = token();
  if (!tk.token) {
    log.needsKey('apify', 'Apify (serviço externo)', 'https://console.apify.com/account#/integrations',
      `Configure ${tk.falta} no servidor`);
    out.push(finding('erro', 'Apify não configurado',
      `A variável ${tk.falta} não está definida no servidor. Esta ferramenta precisa de uma conta Apify.`,
      ['apify'], { confidence: 'confirmed' }));
    return { findings: out, log, notes };
  }

  // Escolher actors
  let actors: ActorDef[];
  if (actorIds?.length) {
    actors = escolherActors(plataforma, actorIds.join(','));
  } else {
    actors = escolherActors(plataforma);
  }
  if (!actors.length) {
    log.error('apify', `Apify (${plataforma})`, '', `nenhum actor habilitado para ${plataforma}`);
    out.push(finding('erro', 'Sem actor', `Nenhum actor Apify habilitado para ${plataforma}.`, ['apify'], { confidence: 'confirmed' }));
    return { findings: out, log, notes };
  }

  // Correr o primeiro actor que funcionar (perfil primeiro)
  const perfilPrimeiro = actors.sort((a, b) => {
    const aProfile = /profile/i.test(a.name) ? 0 : 1;
    const bProfile = /profile/i.test(b.name) ? 0 : 1;
    return aProfile - bProfile;
  });

  let sucesso = false;
  for (const actor of perfilPrimeiro) {
    if (!actor.oficial) {
      notes.push(`${actor.name} (${actor.actorId}) é um actor de terceiros, não oficial do Apify.`);
    }
    if (!actor.viaApiNaFree) {
      notes.push(`${actor.name}: na conta Free do Apify este actor só funciona pela Console (demo). Via API exige plano pago.`);
    }

    const srcId = `apify-${actor.actorId.replace('/', '-')}`;
    const resultado = await correr(actor, alvo);
    const ms = resultado.ms;

    if (resultado.status === 'NOT_CONFIGURED') {
      log.error(srcId, actor.name, `apify.com/${actor.actorId}`, resultado.nota, ms);
      continue;
    }
    if (resultado.status === 'PAYMENT_REQUIRED') {
      log.error(srcId, actor.name, `apify.com/${actor.actorId}`, resultado.nota, ms);
      out.push(finding('erro', 'Sem crédito', resultado.nota, [srcId], { confidence: 'confirmed' }));
      continue;
    }
    if (resultado.status === 'RATE_LIMITED') {
      log.error(srcId, actor.name, `apify.com/${actor.actorId}`, resultado.nota, ms);
      out.push(finding('erro', 'Limite atingido', resultado.nota, [srcId], { confidence: 'confirmed' }));
      continue;
    }
    if (resultado.status === 'ERROR') {
      log.error(srcId, actor.name, `apify.com/${actor.actorId}`, resultado.nota, ms);
      continue;
    }

    // Sucesso
    if (!resultado.itens.length) {
      log.empty(srcId, actor.name, `apify.com/${actor.actorId}`, ms, 'nenhum resultado');
      out.push(finding('resumo', actor.name, 'Nenhum resultado encontrado para este alvo.', [srcId], { confidence: 'confirmed' }));
      sucesso = true;
      continue;
    }

    log.ok(srcId, actor.name, `apify.com/${actor.actorId}`, ms, resultado.itens.length);
    sucesso = true;

    // Processar cada item
    for (const item of resultado.itens) {
      const username = usernameDoItem(item);
      const nome = nomeDoItem(item);
      const foto = fotoDoItem(item);

      // Finding de perfil encontrado (aparece na grelha "Perfis encontrados")
      if (username) {
        const plat = plataforma.charAt(0).toUpperCase() + plataforma.slice(1);
        const urlPerfil = plataforma === 'instagram' ? `https://www.instagram.com/${username}/`
          : plataforma === 'tiktok' ? `https://www.tiktok.com/@${username}`
          : plataforma === 'facebook' ? (typeof (item as Record<string, unknown>).url === 'string' ? String((item as Record<string, unknown>).url) : `https://www.facebook.com/${username}`)
          : plataforma === 'x' ? `https://x.com/${username}`
          : '';
        out.push(finding('encontrado', plat, {
          platform: plat,
          url: urlPerfil,
          username,
          ...(foto ? { profilePic: foto } : {}),
        }, [srcId], { confidence: 'confirmed', link: urlPerfil }));
      }

      // Normalizar e mostrar todos os dados
      const normalizados = actor.normalizer(item);
      for (const { rotulo, valor } of normalizados) {
        out.push(finding('dados', rotulo, valor, [srcId], { confidence: 'confirmed' }));
      }

      // Dados de perfil destacados
      if (nome) out.push(finding('perfil', 'Nome', nome, [srcId], { confidence: 'confirmed' }));

      const obj = item as Record<string, unknown>;
      if (typeof obj.biography === 'string' && obj.biography) {
        out.push(finding('perfil', 'Bio', obj.biography, [srcId], { confidence: 'confirmed' }));
      }
      if (typeof obj.followersCount === 'number') {
        out.push(finding('perfil', 'Seguidores', String(obj.followersCount), [srcId], { confidence: 'confirmed' }));
      } else if (typeof obj.followerCount === 'number') {
        out.push(finding('perfil', 'Seguidores', String(obj.followerCount), [srcId], { confidence: 'confirmed' }));
      }
      if (typeof obj.followingCount === 'number') {
        out.push(finding('perfil', 'Seguindo', String(obj.followingCount), [srcId], { confidence: 'confirmed' }));
      }
      if (obj.verified === true || obj.isVerified === true) {
        out.push(finding('perfil', 'Verificado', 'sim', [srcId], { confidence: 'confirmed' }));
      }
      if (obj.private === true || obj.isPrivate === true) {
        out.push(finding('perfil', 'Conta privada', 'sim', [srcId], { confidence: 'confirmed' }));
      }
    }

    // Parar no primeiro actor que funciona (perfil é o prioritário)
    break;
  }

  if (!sucesso) {
    out.push(finding('erro', 'Falha em todos os actors',
      `Nenhum actor de ${plataforma} conseguiu devolver resultados. Verifique o token e os créditos da conta Apify.`,
      ['apify'], { confidence: 'confirmed' }));
  }

  return { findings: out, log, notes };
}

// =========================================================== INSTAGRAM

registerTool({
  id: 'instagram-osint',
  name: 'Instagram OSINT',
  category: 'pessoa',
  summary: 'Perfil público do Instagram via Apify: bio, seguidores, foto, publicações e dados completos.',
  longDesc: 'Usa o Apify Instagram Profile Scraper (actor oficial `apify/instagram-profile-scraper`) para obter o perfil público completo: nome, bio, foto, seguidores, seguidos, publicações, verificação e conta privada. Todos os dados devolvidos pelo actor são mostrados sem filtro. Custo: pay-per-event na conta Apify.',
  minPlan: 'pro',
  freeTier: false,
  legalGate: 'lgpd',
  tags: ['instagram', 'perfil', 'foto', 'seguidores', 'bio', 'redes', 'apify'],
  fields: [{
    name: 'target',
    label: 'Username ou URL do Instagram',
    type: 'text',
    placeholder: 'ex: @username ou https://instagram.com/username',
    required: true,
    hint: 'Username (com ou sem @) ou URL completa do perfil',
  }],
  async run(input) {
    const alvo = String(input.target ?? '').trim()
      .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
      .replace(/\/+$/, '')
      .replace(/^@/, '');
    if (!alvo) {
      const log = new SourceLog();
      log.local(0, 'alvo vazio');
      return { findings: [finding('validacao', 'Instagram', 'insira um username ou URL', ['local'], { confidence: 'confirmed' })], log };
    }
    // Preferir o profile scraper
    return correrPlataforma('instagram', alvo, ['apify/instagram-profile-scraper', 'apify/instagram-scraper']);
  },
});

// ============================================================== TIKTOK

registerTool({
  id: 'tiktok-osint',
  name: 'TikTok OSINT',
  category: 'pessoa',
  summary: 'Perfil público do TikTok via Apify: bio, seguidores, vídeos e dados completos.',
  longDesc: 'Usa o Clockworks TikTok Profile Scraper (actor de terceiros) para obter o perfil público: nickname, bio, seguidores, seguidos, curtidas totais e número de vídeos. Todos os dados são mostrados sem filtro. Custo: pay-per-event na conta Apify. Actor de terceiros — não é oficial do Apify.',
  minPlan: 'pro',
  freeTier: false,
  legalGate: 'lgpd',
  tags: ['tiktok', 'perfil', 'video', 'seguidores', 'redes', 'apify'],
  fields: [{
    name: 'target',
    label: 'Username ou URL do TikTok',
    type: 'text',
    placeholder: 'ex: @username ou https://tiktok.com/@username',
    required: true,
    hint: 'Username (com ou sem @) ou URL completa do perfil',
  }],
  async run(input) {
    const alvo = String(input.target ?? '').trim()
      .replace(/^https?:\/\/(www\.)?(vm\.)?tiktok\.com\/@?/i, '')
      .replace(/\/+$/, '')
      .replace(/^@/, '');
    if (!alvo) {
      const log = new SourceLog();
      log.local(0, 'alvo vazio');
      return { findings: [finding('validacao', 'TikTok', 'insira um username ou URL', ['local'], { confidence: 'confirmed' })], log };
    }
    return correrPlataforma('tiktok', alvo, ['clockworks/tiktok-profile-scraper', 'clockworks/tiktok-scraper']);
  },
});

// ============================================================ FACEBOOK

registerTool({
  id: 'facebook-osint',
  name: 'Facebook OSINT',
  category: 'pessoa',
  summary: 'Publicações públicas de uma página ou perfil do Facebook via Apify.',
  longDesc: 'Usa o Apify Facebook Posts Scraper (actor oficial) para obter publicações públicas de uma página ou perfil: texto, data, reações, comentários e partilhas. Todos os dados são mostrados sem filtro. Custo: pay-per-event na conta Apify.',
  minPlan: 'pro',
  freeTier: false,
  legalGate: 'lgpd',
  tags: ['facebook', 'perfil', 'publicacoes', 'pagina', 'redes', 'apify'],
  fields: [{
    name: 'target',
    label: 'URL da página ou perfil do Facebook',
    type: 'url',
    placeholder: 'ex: https://facebook.com/pagina',
    required: true,
    hint: 'URL completa da página ou perfil público',
  }],
  async run(input) {
    const alvo = String(input.target ?? '').trim();
    if (!alvo || !alvo.includes('facebook.com')) {
      const log = new SourceLog();
      log.local(0, 'URL inválida');
      return { findings: [finding('validacao', 'Facebook', 'insira a URL de uma página ou perfil do Facebook', ['local'], { confidence: 'confirmed' })], log };
    }
    return correrPlataforma('facebook', alvo, ['apify/facebook-posts-scraper']);
  },
});

// ================================================================== X

registerTool({
  id: 'x-osint',
  name: 'X (Twitter) OSINT',
  category: 'pessoa',
  summary: 'Tweets públicos de um perfil do X (Twitter) via Apify.',
  longDesc: 'Usa o APIdojo Tweet Scraper (actor de terceiros) para obter tweets públicos: texto, data, curtidas, retweets e URL. Todos os dados são mostrados sem filtro. Atenção: na conta Free do Apify este actor só funciona pela Console (demo); via API exige plano pago. Custo: pay-per-event. Actor de terceiros.',
  minPlan: 'pro',
  freeTier: false,
  legalGate: 'lgpd',
  tags: ['twitter', 'x', 'tweets', 'perfil', 'redes', 'apify'],
  fields: [{
    name: 'target',
    label: 'Username ou URL do X (Twitter)',
    type: 'text',
    placeholder: 'ex: @username ou https://x.com/username',
    required: true,
    hint: 'Username (com ou sem @) ou URL do perfil',
  }],
  async run(input) {
    const alvo = String(input.target ?? '').trim()
      .replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '')
      .replace(/\/+$/, '')
      .replace(/^@/, '');
    if (!alvo) {
      const log = new SourceLog();
      log.local(0, 'alvo vazio');
      return { findings: [finding('validacao', 'X', 'insira um username ou URL', ['local'], { confidence: 'confirmed' })], log };
    }
    return correrPlataforma('x', alvo, ['apidojo/tweet-scraper']);
  },
});
