import express from 'express';
import multer from 'multer';
import crypto from 'crypto';

const TOKEN = process.env.BOT_TOKEN; // o token fica SOMENTE nas variáveis de ambiente do servidor
if (!TOKEN) { console.error('Falta a variável BOT_TOKEN'); process.exit(1); }

/* ===== IDs DOS CANAIS ===== */
const CH = {
  spotify: '-1004338748857', saturn: '-1003906133563', selvari: '-1004356036037',
  billboard: '-1003983016655', deezer: '-1003948872931', empire: '-1004320160702',
  vivalatino: '-1004499869122', amazon: '-1003934386776', netflix: '-1004350052339',
  hbo: '-1004331317977', dior: '-1004309006562', versace: '-1004489804724',
  calvinklein: '-1004319958627', ciroc: '-1003504659365', absolut: '-1004295236061',
  fader: '-1003929848566', spotifynews: '-1004416496007'
};
const NAME = {
  spotify: 'Spotify', saturn: 'Saturn', selvari: 'Selvari', billboard: 'Billboard', deezer: 'Deezer',
  empire: 'Empire Records', vivalatino: 'Viva Latino', amazon: 'Amazon', netflix: 'Netflix', hbo: 'HBO',
  dior: 'Dior', versace: 'Versace', calvinklein: 'Calvin Klein', ciroc: 'Ciroc', absolut: 'Absolut',
  fader: 'The Fader', spotifynews: 'Spotify Newsroom'
};
// quais empresas cada formulário pode enviar (validação de segurança)
const ALLOW = {
  artista: ['spotify', 'amazon', 'billboard', 'deezer', 'empire', 'selvari'],
  ator: ['amazon', 'selvari', 'hbo', 'netflix'],
  modelo: ['calvinklein', 'versace', 'dior', 'selvari'],
  atleta: ['selvari'],
  embaixador: ['dior', 'versace', 'ciroc', 'absolut', 'calvinklein'],
  playlist: ['spotify', 'saturn', 'billboard', 'selvari', 'vivalatino'],
  noticia: ['fader', 'spotifynews']
};
const TITLE = { artista: 'Artista verificado', ator: 'Ator contratado', modelo: 'Modelo', atleta: 'Atleta', embaixador: 'Embaixador', playlist: 'Playlist', noticia: 'Notícia' };

/* ===== Telegram ===== */
async function api(method, fields, fileList = []) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fileList.forEach(([n, f]) => fd.append(n, new Blob([f.buffer], { type: f.mimetype }), f.originalname));
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, { method: 'POST', body: fd, signal: AbortSignal.timeout(60000) });
  const j = await r.json();
  if (!j.ok) throw new Error(j.description);
  return j;
}
const kind = f => (f.mimetype.startsWith('video/') ? 'video' : 'photo');
async function deliver(chat, text, files) {
  await api('sendMessage', { chat_id: chat, text, parse_mode: 'HTML' });
  if (!files.length) return;
  try {
    if (files.length === 1) {
      const k = kind(files[0]);
      await api(k === 'video' ? 'sendVideo' : 'sendPhoto', { chat_id: chat }, [[k, files[0]]]);
    } else {
      const media = files.map((f, i) => ({ type: kind(f), media: `attach://f${i}` }));
      await api('sendMediaGroup', { chat_id: chat, media: JSON.stringify(media) }, files.map((f, i) => [`f${i}`, f]));
    }
  } catch (e) { // plano B: manda como documento (aceita arquivos maiores)
    for (const f of files) await api('sendDocument', { chat_id: chat }, [['document', f]]);
  }
}

// confirma que o envio veio mesmo de dentro do Telegram
function checkInit(raw) {
  if (!raw) return null;
  const p = new URLSearchParams(raw);
  const hash = p.get('hash'); p.delete('hash');
  const s = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const key = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const ok = crypto.createHmac('sha256', key).update(s).digest('hex') === hash;
  if (!ok || Date.now() / 1000 - Number(p.get('auth_date')) > 86400) return null;
  try { return JSON.parse(p.get('user')); } catch { return null; }
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ===== Servidor ===== */
const app = express();
app.use(express.static('public'));
const up = multer({
  storage: multer.memoryStorage(),
  limits: { files: 5, fileSize: 45 * 1024 * 1024 },
  fileFilter: (q, f, cb) => cb(null, /^(image|video)\//.test(f.mimetype))
});

app.post('/api/submit', up.array('files', 5), async (req, res) => {
  try {
    const user = checkInit(req.body.initData);
    if (!user) return res.status(401).json({ ok: false, error: 'abra o miniapp pelo Telegram.' });
    const form = req.body.form;
    const comps = JSON.parse(req.body.companies || '[]');
    const answers = JSON.parse(req.body.answers || '[]');
    const files = req.files || [];
    if (!ALLOW[form] || !comps.length || !comps.every(c => ALLOW[form].includes(c)))
      return res.status(400).json({ ok: false, error: 'formulário inválido.' });
    const imgs = files.filter(f => f.mimetype.startsWith('image/')).length;
    if (form === 'noticia' ? files.length < 1 : files.length !== 2 || imgs !== 2)
      return res.status(400).json({ ok: false, error: 'envie os arquivos exigidos.' });

    const who = user.username ? `@${user.username}` : (user.first_name || 'sem @');
    for (const c of comps) {
      const text = `📌 <b>${TITLE[form]}</b> — ${NAME[c]}\n\n` +
        answers.slice(0, 8).map(([l, v]) => `<b>${esc(l).slice(0, 150)}</b>\n${esc(v).slice(0, 1200)}`).join('\n\n') +
        `\n\n👤 Enviado por: ${esc(who)} (id ${user.id})`;
      await deliver(CH[c], text, files);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'erro ao enviar para o canal. Tente de novo em instantes.' });
  }
});

app.use((e, q, r, n) => r.status(400).json({ ok: false, error: e.code === 'LIMIT_FILE_SIZE' ? 'arquivo muito grande (máx. 45 MB).' : 'erro no envio.' }));
app.listen(process.env.PORT || 3000, () => console.log('Miniapp no ar'));
