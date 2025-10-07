import { SessionService } from '../src/web/services/SessionService';

async function main() {
  const svc = new SessionService();
  const token = svc.createSession('890315487962095637', '735854461636837389');
  console.log('created token:', token);
  console.log('sessions map size:', svc.getSessions().size);
  // Wait a moment for disk write
  await new Promise((r) => setTimeout(r, 200));
  const fs = await import('fs');
  const path = `${process.cwd()}/Data/sessions.json`;
  if (fs.existsSync(path)) {
    console.log('sessions.json exists');
    const raw = fs.readFileSync(path, 'utf8');
    console.log('file content:', raw);
  } else {
    console.log('sessions.json not found');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
