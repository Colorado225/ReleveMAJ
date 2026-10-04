// Faux fournisseur SMS — utilisé uniquement pour tester le parcours §60
// dans un build de PRODUCTION (en développement, le code s'affiche déjà).
// Il ne fait qu'accepter le POST et écrire le code dans un fichier.
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';

const OUT = process.env.SMS_STUB_OUT ?? '/tmp/sms-stub.log';

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    // le message est « Votre code ConsoCI : 123456 » ; on isole le code,
    // pas les premiers chiffres du numéro de téléphone.
    const match = body.match(/ConsoCI\s*:\s*(\d{6})/);
    if (match) appendFileSync(OUT, `${match[1]}\n`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"status":"ok"}');
  });
});

server.listen(Number(process.env.SMS_STUB_PORT ?? 4000), () => {
  console.log(`faux fournisseur SMS sur :${process.env.SMS_STUB_PORT ?? 4000}`);
});