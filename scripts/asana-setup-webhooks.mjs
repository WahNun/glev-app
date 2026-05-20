/**
 * asana-setup-webhooks.mjs
 *
 * Liest alle Projekte aus einem Asana-Portfolio, findet die jeweiligen
 * "Replit Queue"-Sektionen und registriert pro Projekt einen Webhook.
 *
 * Aufruf:
 *   ASANA_PAT=1/xxx \
 *   ASANA_WEBHOOK_SECRET=abc \
 *   PORTFOLIO_GID=123456 \
 *   WEBHOOK_TARGET=https://glev.app/api/asana/webhook \
 *   node scripts/asana-setup-webhooks.mjs
 *
 * Optional: REPLIT_QUEUE_SECTION_NAME="Replit Queue"  (default: "Replit Queue")
 */

const PAT           = process.env.ASANA_PAT;
const PORTFOLIO_GID = process.env.PORTFOLIO_GID;
const TARGET        = process.env.WEBHOOK_TARGET ?? 'https://glev.app/api/asana/webhook';
const SECTION_NAME  = process.env.REPLIT_QUEUE_SECTION_NAME ?? 'Replit Queue';

if (!PAT || !PORTFOLIO_GID) {
  console.error('Fehler: ASANA_PAT und PORTFOLIO_GID müssen gesetzt sein.');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${PAT}`,
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

async function asana(path) {
  const res = await fetch(`https://app.asana.com/api/1.0${path}`, { headers });
  if (!res.ok) throw new Error(`Asana ${path} → ${res.status} ${res.statusText}`);
  const json = await res.json();
  return json.data;
}

async function getPortfolioProjects(portfolioGid) {
  const items = await asana(`/portfolios/${portfolioGid}/items?opt_fields=gid,name,resource_type`);
  return items.filter((i) => i.resource_type === 'project');
}

async function getProjectSections(projectGid) {
  return asana(`/projects/${projectGid}/sections?opt_fields=gid,name`);
}

async function registerWebhook(projectGid) {
  const res = await fetch('https://app.asana.com/api/1.0/webhooks', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      data: { resource: projectGid, target: TARGET },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Webhook-Registrierung fehlgeschlagen (${res.status}): ${text}`);
  }
  const json = await res.json();
  return json.data;
}

async function main() {
  console.log(`\nPortfolio ${PORTFOLIO_GID} wird abgerufen…\n`);

  const projects = await getPortfolioProjects(PORTFOLIO_GID);
  console.log(`${projects.length} Projekte gefunden:\n`);

  const queueSectionIds = [];

  for (const project of projects) {
    console.log(`  📁 ${project.name} (${project.gid})`);

    // Sektionen des Projekts abrufen
    let sections;
    try {
      sections = await getProjectSections(project.gid);
    } catch (err) {
      console.log(`     ⚠️  Sektionen nicht abrufbar: ${err.message}`);
      continue;
    }

    const queueSection = sections.find(
      (s) => s.name.trim().toLowerCase() === SECTION_NAME.trim().toLowerCase()
    );

    if (queueSection) {
      console.log(`     ✅ "${SECTION_NAME}" gefunden — GID: ${queueSection.gid}`);
      queueSectionIds.push(queueSection.gid);
    } else {
      console.log(`     ⏭️  Keine "${SECTION_NAME}"-Sektion — übersprungen`);
    }

    // Webhook registrieren (auch wenn keine Queue-Sektion — Asana braucht nur den Projekt-GID)
    if (queueSection) {
      try {
        const webhook = await registerWebhook(project.gid);
        console.log(`     🔗 Webhook registriert (GID: ${webhook.gid})`);
      } catch (err) {
        // "already exists" ist kein Fehler
        if (err.message.includes('already exists') || err.message.includes('duplicate')) {
          console.log(`     ℹ️  Webhook bereits vorhanden`);
        } else {
          console.log(`     ⚠️  Webhook-Fehler: ${err.message}`);
        }
      }
    }
  }

  console.log('\n─────────────────────────────────────────────────────');
  if (queueSectionIds.length === 0) {
    console.log(`\n⚠️  Keine "${SECTION_NAME}"-Sektionen gefunden.`);
    console.log('   Prüfe den Sektionsnamen oder erstelle die Sektion in den Projekten.\n');
  } else {
    console.log('\n✅ Alle Webhooks registriert. Setze diese Env-Variable:\n');
    console.log(`ASANA_REPLIT_QUEUE_SECTION_IDS=${queueSectionIds.join(',')}`);
    console.log('\n→ In Vercel: Settings → Environment Variables');
    console.log('→ Lokal: .env.local\n');
  }
}

main().catch((err) => {
  console.error('\n❌ Fehler:', err.message);
  process.exit(1);
});
