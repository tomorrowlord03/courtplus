import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, chmod, link, open, readdir, rename, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';

const magic = Buffer.from('CPHEAR01');
const blockSize = 1024 * 1024;
const headerSize = 4 + 12 + 16;

export const hearingId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const transcriptFile = /^v\d{4,6}\.json$/;
export const chunkFile = /^\d{6,7}\.part$/;

export async function exists(path: string) {
  return access(path).then(() => true, (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return false;
    throw error;
  });
}

export async function filenames(path: string) {
  return readdir(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [] as string[];
    throw error;
  });
}

export function hearingStorage(directory: string, key: Buffer) {
  // Bind each frame to its recording, file name and position. A final empty frame seals the length.
  const associatedData = (id: string, name: string, index: number) => Buffer.from(`${id}/${name}:${index}`);
  const pathOf = (id: string, name: string) => join(directory, id, name + '.enc');

  async function write(id: string, name: string, chunks: AsyncIterable<Uint8Array>, replace = false) {
    const target = pathOf(id, name);
    const temporary = target + '.' + randomUUID() + '.tmp';
    const file = await open(temporary, 'wx', 0o600);
    try {
      try {
        await file.writeFile(magic);
        let index = 0;
        const frame = async (plain: Uint8Array) => {
          const header = Buffer.alloc(headerSize);
          header.writeUInt32BE(plain.length);
          const iv = randomBytes(12);
          iv.copy(header, 4);
          const cipher = createCipheriv('aes-256-gcm', key, iv);
          cipher.setAAD(associatedData(id, name, index++));
          const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
          cipher.getAuthTag().copy(header, 16);
          await file.writeFile(Buffer.concat([header, encrypted]));
        };
        for await (const chunk of chunks) {
          for (let offset = 0; offset < chunk.length; offset += blockSize) {
            await frame(chunk.subarray(offset, offset + blockSize));
          }
        }
        await frame(new Uint8Array());
        await file.sync();
      } finally {
        await file.close();
      }
      if (replace) {
        if (await exists(target)) await chmod(target, 0o600);
        await rename(temporary, target);
      } else {
        await link(temporary, target);
        await unlink(temporary);
      }
      await chmod(target, 0o400);
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }

  async function* read(id: string, name: string) {
    const file = await open(pathOf(id, name), 'r');
    const readExactly = async (size: number) => {
      const result = Buffer.allocUnsafe(size);
      let offset = 0;
      while (offset < size) {
        const { bytesRead } = await file.read(result, offset, size - offset, null);
        if (!bytesRead) throw new Error('Truncated encrypted hearing file.');
        offset += bytesRead;
      }
      return result;
    };
    try {
      if (!(await readExactly(magic.length)).equals(magic)) throw new Error('Invalid encrypted hearing file.');
      for (let index = 0; ; index += 1) {
        const header = await readExactly(headerSize);
        const size = header.readUInt32BE(0);
        if (size > blockSize) throw new Error('Invalid encrypted hearing frame.');
        const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(4, 16));
        decipher.setAAD(associatedData(id, name, index));
        decipher.setAuthTag(header.subarray(16));
        const plain = Buffer.concat([decipher.update(await readExactly(size)), decipher.final()]);
        if (size === 0) {
          if ((await file.read(Buffer.alloc(1))).bytesRead) throw new Error('Unexpected data after the final hearing frame.');
          return;
        }
        yield plain;
      }
    } finally {
      await file.close();
    }
  }

  async function readBytes(id: string, name: string) {
    const chunks: Buffer[] = [];
    for await (const chunk of read(id, name)) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  async function migrate() {
    for (const id of (await filenames(directory)).filter(name => hearingId.test(name))) {
      const hearing = join(directory, id);
      const root = await filenames(hearing);
      const chunks = await filenames(join(hearing, 'chunks'));
      const legacy = [
        ...root.filter(name => name === 'audio.webm' || transcriptFile.test(name)),
        ...chunks.filter(name => chunkFile.test(name)).map(name => 'chunks/' + name),
      ];
      for (const name of legacy) {
        const plain = join(hearing, name);
        await write(id, name, createReadStream(plain), true);
        await chmod(plain, 0o600);
        await unlink(plain);
      }
      // Incomplete temporary files contain only ciphertext.
      for (const name of [...root, ...chunks.map(name => 'chunks/' + name)]) {
        if (/\.enc\.[a-f0-9-]{36}\.tmp$/.test(basename(name))) await unlink(join(hearing, name));
      }
    }
  }

  return { write, read, readBytes, pathOf, migrate };
}
