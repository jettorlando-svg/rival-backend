const http   = require('http');
const crypto = require('crypto');
const url    = require('url');

const PORT                 = process.env.PORT || 3000;
const BASE_URL             = process.env.BASE_URL || `http://localhost:${PORT}`;
const MATCH_EXPIRY_MINUTES = 30;
const matches              = {};

function generateId()    { return crypto.randomUUID(); }
function generateToken() { return crypto.randomBytes(16).toString('hex'); }
function isExpired(m)    { return Date.now() - new Date(m.created_at).getTime() > MATCH_EXPIRY_MINUTES * 60000; }

function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => raw += c);
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(); } });
    req.on('error', reject);
  });
}

// Expire stale matches every 5 min
setInterval(() => {
  for (const id in matches)
    if (matches[id].status === 'waiting' && isExpired(matches[id]))
      matches[id].status = 'expired';
}, 300000);

http.createServer(async (req, res) => {

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }
  const p  = url.parse(req.url, true);
  const pn = p.pathname;
  const qs = p.query;
  const m  = req.method;

  // POST /create-match
  if (m === 'POST' && pn === '/create-match') {
    let b; try { b = await readBody(req); } catch { return send(res, 400, { error: 'Invalid JSON' }); }
    const { creator_user_id = 'user_'+generateId().slice(0,8), bet_amount, first_to_wins = 1, turbo_mode = false } = b;
    if (!bet_amount || isNaN(bet_amount) || +bet_amount <= 0) return send(res, 400, { error: 'bet_amount must be a positive number' });
    const ftw = Number(first_to_wins);
    if (!Number.isInteger(ftw) || ftw < 1 || ftw > 100) return send(res, 400, { error: 'first_to_wins must be 1–100' });
    const match_id = generateId(), token = generateToken(), now = new Date();
    const match = { match_id, invite_token: token, creator_user_id, opponent_user_id: null,
      bet_amount: +bet_amount, first_to_wins: ftw, turbo_mode: !!turbo_mode,
      status: 'waiting', created_at: now.toISOString(),
      expires_at: new Date(+now + MATCH_EXPIRY_MINUTES*60000).toISOString(),
      score: { creator: 0, opponent: 0 } };
    matches[match_id] = match;
    console.log(`[created] ${match_id} by ${creator_user_id}`);
    return send(res, 201, { success: true, invite_link: `file:///C:/Users/Admin/Downloads/rival-coinflip%20(8).html?token=${token}`, match });
  }

  // GET /join-match/:token
  const jr = pn.match(/^\/join-match\/([a-f0-9]+)$/);
  if (m === 'GET' && jr) {
    const token   = jr[1];
    const user_id = qs.user_id || 'user_'+generateId().slice(0,8);
    const match   = Object.values(matches).find(x => x.invite_token === token);
    if (!match)                                    return send(res, 404, { error: 'Match not found.' });
    if (isExpired(match)||match.status==='expired'){ match.status='expired'; return send(res, 410, { error: 'Invite link has expired.' }); }
    if (match.status === 'active')                 return send(res, 409, { error: 'Match is already full.' });
    if (match.status === 'finished')               return send(res, 410, { error: 'Match has already finished.' });
    if (match.status !== 'waiting')                return send(res, 409, { error: `Match not joinable (${match.status}).` });
    if (user_id === match.creator_user_id)         return send(res, 400, { error: 'Cannot join your own match.' });
    match.opponent_user_id = user_id;
    match.status           = 'active';
    match.started_at       = new Date().toISOString();
    console.log(`[joined] ${match.match_id} by ${user_id}`);
    return send(res, 200, { success: true, message: 'Joined! Good luck.', match });
  }

  // GET /match/:id
  const mr = pn.match(/^\/match\/([a-f0-9-]+)$/);
  if (m === 'GET' && mr) {
    const match = matches[mr[1]];
    return match ? send(res, 200, { success: true, match }) : send(res, 404, { error: 'Match not found.' });
  }

  // GET /matches (dev)
  if (m === 'GET' && pn === '/matches')
    return send(res, 200, { success: true, count: Object.keys(matches).length, matches });

  send(res, 404, { error: `Not found: ${m} ${pn}` });

}).listen(PORT, () => {
  console.log(`\nRIVAL backend → http://localhost:${PORT}`);
  console.log('  POST /create-match');
  console.log('  GET  /join-match/:token?user_id=xxx');
  console.log('  GET  /match/:match_id');
  console.log('  GET  /matches\n');
});