import fs from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { within, safeID, readJSON, writeJSON, withLock } from './files.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const imageID = id => /^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(id || '');
const imagePath = (scope, id) => `.spequi/reviews/${safeID(scope)}/images/${id}`;

export async function readReviewImage(root, scope, id) {
  if (!imageID(id)) throw new Error('Invalid image reference');
  const file = imagePath(scope, id);
  const metadata = await readJSON(await within(root, file + '.json'));
  if (!metadata) throw new Error('Reference image not found');
  const bytes = await fs.readFile(await within(root, file));
  if (digest(bytes) !== metadata.hash) throw new Error('Reference image changed since upload');
  return { ...metadata, type: { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[id.split('.').at(-1)], id, file, url: `/api/reviews/${scope}/images/${id}`, bytes };
}

export async function saveReviewImage(root, scope, { name, type, data }) {
  safeID(scope);
  if (typeof data !== 'string' || data.length > 7 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error('Choose an image up to 5 MiB');
  const bytes = Buffer.from(data, 'base64');
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error('Choose an image up to 5 MiB');
  const png = bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR';
  const jpg = bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = bytes.length >= 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  const format = png ? ['image/png', 'png'] : jpg ? ['image/jpeg', 'jpg'] : webp ? ['image/webp', 'webp'] : null;
  if (!format || type !== format[0]) throw new Error('Use a PNG, JPEG or WebP image');
  if (png && (!bytes.readUInt32BE(16) || !bytes.readUInt32BE(20) || bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > 40000000)) throw new Error('Choose an image smaller than 40 megapixels');
  return withLock(await within(root, `.spequi/reviews/${scope}/images.lock`), async () => {
    const directory = await within(root, `.spequi/reviews/${scope}/images`);
    await fs.mkdir(directory, { recursive: true });
    let size = 0;
    for (const file of await fs.readdir(directory)) if (imageID(file)) size += (await fs.stat(await within(root, imagePath(scope, file)))).size;
    if (size + bytes.length > 100 * 1024 * 1024) throw new Error('This review has reached its 100 MiB image limit');
    const id = `${randomUUID()}.${format[1]}`, file = imagePath(scope, id);
    const metadata = { name: String(name || `Reference.${format[1]}`).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 160), type: format[0], size: bytes.length, hash: digest(bytes) };
    await fs.writeFile(await within(root, file), bytes, { flag: 'wx', mode: 0o600 });
    await writeJSON(await within(root, file + '.json'), metadata);
    return { ...metadata, id, file, url: `/api/reviews/${scope}/images/${id}` };
  });
}

export async function commentImages(root, scope, value = []) {
  let ids;
  try { ids = typeof value === 'string' ? JSON.parse(value) : value; } catch { throw new Error('Invalid image references'); }
  if (!Array.isArray(ids) || ids.length > 4 || new Set(ids).size !== ids.length) throw new Error('Attach up to four images per comment');
  return Promise.all(ids.map(async id => { const { bytes, ...image } = await readReviewImage(root, scope, id); return image; }));
}
