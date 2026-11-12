// Publie sur le profil LinkedIn de Pierre-Arthur le post prévu pour aujourd'hui,
// puis le premier commentaire qui porte le lien.
//
// Tourne sur GitHub Actions pour que la publication parte PC éteint. Le jeton
// vient du secret LINKEDIN_TOKEN ; il dure 60 jours et LinkedIn n'en accorde
// pas le renouvellement automatique à un compte de développeur ordinaire.
//
// Idempotent : publies.json garde ce qui est parti. Une seconde exécution le
// même jour ne republie pas le post, et ne fait que le commentaire s'il manque.
// Tout échec fait échouer la tâche, et GitHub prévient alors par email.
import { readFileSync, writeFileSync } from 'node:fs';

const TOKEN = process.env.LINKEDIN_TOKEN;
const VERSION = '202610';
const ESSAI = process.env.ESSAI === 'true';

if (!TOKEN) throw new Error('Secret LINKEDIN_TOKEN absent.');

const auj = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
const heure = Number(new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false }));

const posts = JSON.parse(readFileSync('posts.json', 'utf8'));
const publies = JSON.parse(readFileSync('publies.json', 'utf8'));

async function api(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'X-Restli-Protocol-Version': '2.0.0',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`${options.method || 'GET'} ${url} : ${r.status} ${await r.text()}`);
  return r;
}

// Le champ commentary réserve une quinzaine de caractères à ses annotations :
// une parenthèse non échappée suffit à faire refuser le post. Les hashtags, eux,
// sont rendus cliquables au lieu d'être échappés comme le fait Jarvis.
function commentary(texte) {
  return texte
    .replace(/([\\|{}@\[\]()<>#*_~])/g, '\\$1')
    .replace(/\\#([\p{L}\p{N}_]+)/gu, (_, mot) => `{hashtag|\\#|${mot}}`);
}

const moi = await (await api('https://api.linkedin.com/v2/userinfo')).json();
const auteur = `urn:li:person:${moi.sub}`;
console.log(`Jeton valide pour ${moi.name}.`);

const post = posts.find((p) => p.date === auj);
if (ESSAI) {
  const prochain = posts.find((p) => p.date >= auj && !publies[p.n]?.commentaire);
  console.log(prochain ? `Essai : prochain post ${prochain.n} le ${prochain.date}.` : 'Essai : plus rien à publier.');
  console.log(commentary(prochain?.texte || '').slice(0, 300));
  process.exit(0);
}
if (!post) {
  console.log(`Rien de prévu le ${auj}.`);
  process.exit(0);
}

const etat = publies[post.n] || {};
if (etat.commentaire) {
  console.log(`Post ${post.n} déjà publié avec son commentaire.`);
  process.exit(0);
}
// Une exécution retardée par GitHub au-delà de midi ne publie plus : le
// créneau du matin est passé, et l'échec prévient Pierre-Arthur.
if (!etat.post && heure >= 12) throw new Error(`Post ${post.n} non publié avant midi (il est ${heure} h).`);

const enregistrer = () => writeFileSync('publies.json', JSON.stringify(publies, null, 2) + '\n');

if (!etat.post) {
  const r = await api('https://api.linkedin.com/rest/posts', {
    method: 'POST',
    headers: { 'LinkedIn-Version': VERSION },
    body: JSON.stringify({
      author: auteur,
      commentary: commentary(post.texte),
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    }),
  });
  etat.post = r.headers.get('x-restli-id');
  etat.publie_le = new Date().toISOString();
  publies[post.n] = etat;
  enregistrer();
  console.log(`Post ${post.n} publié : ${etat.post}`);
  // Un commentaire posté à la seconde où le post naît est parfois refusé.
  await new Promise((ok) => setTimeout(ok, 20000));
}

const c = await api(`https://api.linkedin.com/v2/socialActions/${encodeURIComponent(etat.post)}/comments`, {
  method: 'POST',
  body: JSON.stringify({ actor: auteur, object: etat.post, message: { text: post.commentaire } }),
});
const corps = await c.json().catch(() => ({}));
etat.commentaire = corps.$URN || corps.id || c.headers.get('x-restli-id') || true;
enregistrer();
console.log(`Premier commentaire publié sous le post ${post.n}.`);
