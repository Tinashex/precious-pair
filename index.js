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

app.get('/', (req, res) => {
    res.send(`
    <h2>ALEXA-MIN Pair Server ✅</h2>
    <p>Use <b>/code?number=263xxxxxxxxx</b> to get pairing code</p>
    <p>After you enter code, check <b>/session?number=263...</b> to get creds.json</p>
    `);
});

app.get('/code', async (req, res) => {
    let num = (req.query.number || '').replace(/[^0-9]/g, '');
    if (!num || num.length < 10) return res.json({ error: 'Use ?number=263785123456' });

    const authPath = path.join(__dirname, 'auth', num);

    try {
        if (fs.existsSync(authPath)) fs.rmSync(authPath, { recursive: true, force: true });
        const { state, saveCreds } = await useMultiFileAuthState(authPath);

        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
            },
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: ['ALEXA-MIN', 'Chrome', '1.0.0']
        });

        sessions.set(num, sock);
        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            if (update.connection === 'open') console.log(`✅ ${num} Connected!`);
        });

        if (!sock.authState.creds.registered) {
            await delay(1500);
            let code = await sock.requestPairingCode(num);
            code = code?.match(/.{1,4}/g)?.join('-') || code;
            console.log(`Code for ${num}: ${code}`);
            return res.json({ code: code });
        } else {
            return res.json({ error: 'Already registered' });
        }
    } catch (e) {
        res.json({ error: e.message });
    }
});

app.get('/session', async (req, res) => {
    let num = (req.query.number || '').replace(/[^0-9]/g, '');
    const authPath = path.join(__dirname, 'auth', num);
    const credsPath = path.join(authPath, 'creds.json');

    if (!fs.existsSync(credsPath)) {
        return res.json({ status: 'waiting', message: 'Not yet paired. Enter code in WhatsApp first.' });
    }

    try {
        const credsData = fs.readFileSync(credsPath, 'utf8');
        
        if (req.query.download === 'true') {
            res.setHeader('Content-Disposition', `attachment; filename=creds-${num}.json`);
            res.setHeader('Content-Type', 'application/json');
            return res.send(credsData);
        }

        return res.json({
            status: 'connected',
            downloadUrl: `/session?number=${num}&download=true`,
            creds: JSON.parse(credsData)
        });
    } catch (e) {
        res.json({ error: e.message });
    }
});

app.get('/delete', (req, res) => {
    let num = (req.query.number || '').replace(/[^0-9]/g, '');
    const authPath = path.join(__dirname, 'auth', num);
    try {
        if (fs.existsSync(authPath)) fs.rmSync(authPath, { recursive: true, force: true });
        res.json({ success: true });
    } catch (e) {
        res.json({ error: e.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
