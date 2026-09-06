const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { default: makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');

const app = express();
app.use(cors());
app.use(express.json());

// Store active sockets
const sessions = new Map();

app.get('/', (req, res) => {
    res.send(`
    <h2>ALEXA-MIN Pair Server ✅</h2>
    <p>Use <b>/code?number=263xxxxxxxxx</b> to get pairing code</p>
    <p>After you enter code in WhatsApp > Linked Devices, check <b>/session?number=263...</b> to get creds.json</p>
    `);
});

// Step 1: Get pairing code
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
            const { connection } = update;
            if (connection === 'open') {
                console.log(`✅ ${num} Connected!`);
                // Creds are saved in auth folder
                await delay(2000);
            }
            if (connection === 'close') {
                console.log(`Closed ${num}`);
            }
        });

        if (!sock.authState.creds.registered) {
            await delay(1500);
            let code = await sock.requestPairingCode(num);
            code = code?.match(/.{1,4}/g)?.join('-') || code;
            console.log(`Code for ${num}: ${code}`);
            return res.json({ code: code, message: 'Enter this code in WhatsApp > Linked Devices > Link with phone number' });
        } else {
            return res.json({ error: 'Already registered' });
        }

    } catch (e) {
        console.error(e);
        res.json({ error: e.message });
    }
});

// Step 2: Get session / creds.json after pairing
app.get('/session', async (req, res) => {
    let num = (req.query.number || '').replace(/[^0-9]/g, '');
    if (!num) return res.json({ error: 'Need ?number=263...' });

    const authPath = path.join(__dirname, 'auth', num);
    const credsPath = path.join(authPath, 'creds.json');

    if (!fs.existsSync(credsPath)) {
        return res.json({ 
            status: 'waiting',
            message: 'Not yet paired. Enter code in WhatsApp first, then refresh this page after 5 seconds.',
            codeEndpoint: `/code?number=${num}`
        });
    }

    try {
        const credsData = fs.readFileSync(credsPath, 'utf8');
        const credsJson = JSON.parse(credsData);
        
        // Create session ID - base64 of creds
        const sessionId = Buffer.from(credsData).toString('base64');

        // Return as download or json
        if (req.query.download === 'true') {
            res.setHeader('Content-Disposition', `attachment; filename=creds-${num}.json`);
            res.setHeader('Content-Type', 'application/json');
            return res.send(credsData);
        }

        return res.json({
            status: 'connected',
            number: num,
            creds: credsJson,
            sessionId: sessionId.slice(0, 100) + '... (full is long)',
            downloadUrl: `/session?number=${num}&download=true`,
            instructions: '1. Download creds.json via downloadUrl OR copy sessionId. 2. Put creds.json in your bot auth_info_baileys folder OR use sessionId in your bot.'
        });

    } catch (e) {
        res.json({ error: e.message });
    }
});

// Delete session
app.get('/delete', (req, res) => {
    let num = (req.query.number || '').replace(/[^0-9]/g, '');
    if (!num) return res.json({ error: 'Need ?number=' });
    const authPath = path.join(__dirname, 'auth', num);
    try {
        if (fs.existsSync(authPath)) fs.rmSync(authPath, { recursive: true, force: true });
        const sock = sessions.get(num);
        if (sock) try { sock.end(); } catch {}
        sessions.delete(num);
        res.json({ success: true, message: `Deleted session for ${num}` });
    } catch (e) {
        res.json({ error: e.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
