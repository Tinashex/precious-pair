const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { default: makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');

const app = express();
app.use(cors());
app.use(express.json());

const sessions = new Map();

// HTML UI
const htmlPage = `
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ALEXA-MIN Pair</title>
<style>
body{font-family:Arial;background:#0f0f0f;color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}
.card{background:#1a1a1a;padding:25px;border-radius:15px;width:90%;max-width:400px;box-shadow:0 0 20px #00ff88a0;text-align:center}
input{width:90%;padding:12px;border-radius:8px;border:none;margin:10px 0;font-size:16px}
button{width:95%;padding:12px;background:#00ff88;color:#000;border:none;border-radius:8px;font-weight:bold;font-size:16px;cursor:pointer;margin-top:10px}
button:hover{background:#00cc6a}
.code{font-size:32px;letter-spacing:4px;background:#000;padding:15px;border-radius:10px;margin:15px 0;color:#00ff88;font-weight:bold}
a{color:#00ff88;text-decoration:none}
.status{margin-top:15px;font-size:14px;color:#aaa}
</style>
</head>
<body>
<div class="card">
<h2>🤖 ALEXA-MIN PAIR</h2>
<p>Enter your WhatsApp number with country code</p>
<input id="number" placeholder="263785123456" type="number">
<button onclick="getCode()">GET PAIR CODE</button>
<div id="result"></div>
<div id="sessionBox" style="display:none">
<button onclick="getSession()" style="background:#fff">CHECK IF PAIRED & GET CREDS</button>
<button onclick="downloadCreds()" style="background:#0088ff;color:#fff">DOWNLOAD creds.json</button>
</div>
<div class="status" id="status"></div>
</div>

<script>
let currentNumber = "";
async function getCode(){
  const num = document.getElementById('number').value.replace(/[^0-9]/g,'');
  if(!num || num.length < 10){ alert('Enter valid number like 263785123456'); return; }
  currentNumber = num;
  document.getElementById('result').innerHTML = "⏳ Requesting code...";
  document.getElementById('status').innerHTML = "";
  try{
    const res = await fetch('/code?number='+num);
    const data = await res.json();
    if(data.code){
      document.getElementById('result').innerHTML = '<p>Your Pair Code:</p><div class="code">'+data.code+'</div><p>Go to WhatsApp > Linked Devices > Link with phone number > Enter this code</p>';
      document.getElementById('sessionBox').style.display = 'block';
      document.getElementById('status').innerHTML = 'After entering code, click "CHECK IF PAIRED"';
    } else {
      document.getElementById('result').innerHTML = '❌ '+(data.error||'Failed');
    }
  }catch(e){
    document.getElementById('result').innerHTML = '❌ Error: '+e.message;
  }
}

async function getSession(){
  if(!currentNumber) return;
  document.getElementById('status').innerHTML = '⏳ Checking...';
  try{
    const res = await fetch('/session?number='+currentNumber);
    const data = await res.json();
    if(data.status === 'connected'){
      document.getElementById('status').innerHTML = '✅ PAIRED! Now download creds.json';
    } else {
      document.getElementById('status').innerHTML = '⏳ '+data.message;
    }
  }catch(e){
    document.getElementById('status').innerHTML = '❌ '+e.message;
  }
}

function downloadCreds(){
  if(!currentNumber) return;
  window.location.href = '/session?number='+currentNumber+'&download=true';
}
</script>
</body>
</html>
`;

app.get('/', (req, res) => res.send(htmlPage));

app.get('/code', async (req, res) => {
    let num = (req.query.number || '').replace(/[^0-9]/g, '');
    if (!num || num.length < 10) return res.json({ error: 'Invalid number' });
    const authPath = path.join(__dirname, 'auth', num);
    try {
        if (fs.existsSync(authPath)) fs.rmSync(authPath, { recursive: true, force: true });
        const { state, saveCreds } = await useMultiFileAuthState(authPath);
        const sock = makeWASocket({
            auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })) },
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: ['ALEXA-MIN', 'Chrome', '1.0.0']
        });
        sessions.set(num, sock);
        sock.ev.on('creds.update', saveCreds);
        if (!sock.authState.creds.registered) {
            await delay(1500);
            let code = await sock.requestPairingCode(num);
            code = code?.match(/.{1,4}/g)?.join('-') || code;
            return res.json({ code: code });
        } else {
            return res.json({ error: 'Already registered' });
        }
    } catch (e) { res.json({ error: e.message }); }
});

app.get('/session', async (req, res) => {
    let num = (req.query.number || '').replace(/[^0-9]/g, '');
    const credsPath = path.join(__dirname, 'auth', num, 'creds.json');
    if (!fs.existsSync(credsPath)) return res.json({ status: 'waiting', message: 'Not paired yet. Enter code in WhatsApp first.' });
    try {
        const credsData = fs.readFileSync(credsPath, 'utf8');
        if (req.query.download === 'true') {
            res.setHeader('Content-Disposition', `attachment; filename=creds-${num}.json`);
            res.setHeader('Content-Type', 'application/json');
            return res.send(credsData);
        }
        return res.json({ status: 'connected', downloadUrl: `/session?number=${num}&download=true` });
    } catch (e) { res.json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on ${PORT}`));
