# REPLIT PROMPT — Email DNS Diagnose für glev.app

Paste everything between === BEGIN === and === END === into Replit AI.

=== BEGIN ===

## AUFGABE

Führe eine DNS- und SMTP-Diagnose für glev.app durch um herauszufinden warum eingehende E-Mails an info@glev.app nicht ankommen.

Erstelle eine Datei `scripts/email-diagnose.js` und führe sie aus.

```js
const dns = require('dns').promises;
const net = require('net');

async function diagnose() {
  console.log('=== glev.app Email Diagnose ===\n');

  // 1. MX Records
  try {
    const mx = await dns.resolveMx('glev.app');
    mx.sort((a, b) => a.priority - b.priority);
    console.log('✓ MX Records gefunden:');
    mx.forEach(r => console.log(`  ${r.priority} ${r.exchange}`));
  } catch (e) {
    console.log('✗ MX Records: FEHLER —', e.code);
  }

  console.log('');

  // 2. A Record (Webseite)
  try {
    const a = await dns.resolve4('glev.app');
    console.log('✓ A Record (Website):', a.join(', '));
  } catch (e) {
    console.log('✗ A Record: FEHLER —', e.code);
  }

  console.log('');

  // 3. SPF TXT Record
  try {
    const txt = await dns.resolveTxt('glev.app');
    const spf = txt.find(r => r.join('').includes('spf'));
    if (spf) {
      console.log('✓ SPF Record:', spf.join(''));
    } else {
      console.log('⚠ Kein SPF Record gefunden');
    }
  } catch (e) {
    console.log('✗ TXT/SPF: FEHLER —', e.code);
  }

  console.log('');

  // 4. DMARC
  try {
    const dmarc = await dns.resolveTxt('_dmarc.glev.app');
    console.log('✓ DMARC Record:', dmarc[0]?.join(''));
  } catch (e) {
    console.log('⚠ DMARC: Kein Record gefunden (', e.code, ')');
  }

  console.log('');

  // 5. SMTP Verbindungstest zu mx1.privateemail.com:25
  await new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(5000);
    socket.connect(25, 'mx1.privateemail.com', () => {
      console.log('✓ SMTP Verbindung zu mx1.privateemail.com:25 — ERREICHBAR');
      socket.destroy();
      resolve();
    });
    socket.on('timeout', () => {
      console.log('✗ SMTP mx1.privateemail.com:25 — TIMEOUT (Port blockiert?)');
      socket.destroy();
      resolve();
    });
    socket.on('error', (err) => {
      console.log('✗ SMTP mx1.privateemail.com:25 — FEHLER:', err.message);
      resolve();
    });
  });

  console.log('');

  // 6. MX A-Record Auflösung
  try {
    const mxA = await dns.resolve4('mx1.privateemail.com');
    console.log('✓ mx1.privateemail.com IP:', mxA.join(', '));
  } catch (e) {
    console.log('✗ mx1.privateemail.com A-Record: FEHLER —', e.code);
  }

  console.log('\n=== Diagnose abgeschlossen ===');
}

diagnose().catch(console.error);
```

Führe aus mit:
```bash
node scripts/email-diagnose.js
```

Schick mir die komplette Ausgabe.

=== END ===
