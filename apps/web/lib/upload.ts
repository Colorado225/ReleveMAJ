import { createHash, randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads');

/**
 * Types MIME réellement acceptés pour un reçu.
 * On ne se fie jamais à l'extension du fichier.
 */
const ALLOWED_TYPES = new Map<string, string>([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/heic', '.heic'],
  ['application/pdf', '.pdf'],
]);

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 Mo

export type UploadResult =
  | { ok: true; path: string; bytes: number; mime: string }
  | { ok: false; error: string };

/**
 * Validation et stockage d'un reçu (flow.md §40).
 *
 * Contrôles : signature binaire du fichier (magic bytes), taille, type MIME
 * déclaré. Le nom sur disque est regénéré : un nom fourni par l'utilisateur
 * ne touche jamais le système de fichiers (protection contre le path traversal
 * et les extensions doubles).
 */
export async function saveReceipt(file: File): Promise<UploadResult> {
  if (file.size === 0) return { ok: false, error: 'Le fichier est vide.' };
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: 'Le fichier dépasse la taille maximale de 5 Mo.' };
  }

  const ext = ALLOWED_TYPES.get(file.type);
  if (!ext) {
    return { ok: false, error: 'Format non accepté. Utilisez une image (JPEG, PNG, WebP, HEIC) ou un PDF.' };
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  // vérification de la signature : le type déclaré peut être menteur
  if (!hasExpectedSignature(bytes, file.type)) {
    return { ok: false, error: 'Le contenu du fichier ne correspond pas à son format déclaré.' };
  }

  const dir = path.join(UPLOAD_DIR, new Date().toISOString().slice(0, 7));
  await mkdir(dir, { recursive: true });

  const storedName = `${randomUUID()}${ext}`;
  await writeFile(path.join(dir, storedName), bytes, { mode: 0o600 });

  return {
    ok: true,
    path: path.posix.join(dir.split(path.sep).join('/'), storedName),
    bytes: bytes.length,
    mime: file.type,
  };
}

function hasExpectedSignature(buf: Buffer, mime: string): boolean {
  if (buf.length < 12) return false;
  switch (mime) {
    case 'image/jpeg':
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case 'image/png':
      return buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'application/pdf':
      return buf.subarray(0, 5).toString('ascii') === '%PDF-';
    case 'image/webp':
      return buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP';
    case 'image/heic':
      // conteneur ISO-BMFF : marqueur «ftyp » en offset 4
      return buf.subarray(4, 8).toString('ascii') === 'ftyp';
    default:
      return false;
  }
}

/** Checksum du fichier stocké, utile pour l'audit. */
export function checksum(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

/**
 * Supprime un fichier déposé, en refusant toute sortie du dossier d'upload.
 *
 * Le chemin vient de la base, pas de l'utilisateur, mais on vérifie malgré tout :
 * une traversée de répertoire ici supprimerait un fichier arbitraire du serveur.
 * best-effort : un échec ne doit pas faire échouer l'action métier.
 */
export async function deleteUploadedFile(relativePath: string | null | undefined): Promise<boolean> {
  if (!relativePath) return false;

  try {
    const root = path.resolve(UPLOAD_DIR);
    const target = path.resolve(root, relativePath);

    // garde-fou : la cible doit rester sous le dossier d'upload
    if (target !== root && !target.startsWith(root + path.sep)) return false;

    await unlink(target);
    return true;
  } catch {
    // fichier déjà absent ou droits insuffisants : sans conséquence
    return false;
  }
}