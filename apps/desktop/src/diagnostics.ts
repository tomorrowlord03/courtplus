import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { app, BrowserWindow, safeStorage, type Session } from 'electron';
import type * as Ort from 'onnxruntime-node';
import { appendAudit, verifyAuditChain } from './audit';
import { diagnosticResources, lockDownWindow, pdfUrl, webPreferences } from './renderer';
import { openEncryptedDatabase } from './store';
import { timeStartup } from './startup-perf';

type Check = { ok: true; detail: string } | { ok: false; error: string };

export interface DiagnosticsReport {
  timestamp: string;
  packaged: boolean;
  electron: string;
  platform: string;
  architecture: string;
  portable: boolean;
  sqlcipher: Check;
  onnx: Check;
  devanagariPdf: Check;
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function check(run: () => string | Promise<string>): Promise<Check> {
  try {
    return { ok: true, detail: await run() };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

async function checkSqlCipher(directory: string): Promise<string> {
  const scratch = mkdtempSync(join(directory, 'diag-db-'));
  try {
    const writer = await openEncryptedDatabase(scratch, safeStorage);
    let head: string;
    try {
      writer.prepare("INSERT INTO settings (key, value) VALUES ('diagnostic', 'passed')").run();
      const entry = appendAudit(writer, 'diagnostics', 'sqlcipher.probe', 'passed');
      head = entry.hash;
      try {
        writer.prepare('DELETE FROM audit_log WHERE id = ?').run(entry.id);
        throw new Error('Audit log allowed deletion');
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('append-only')) throw error;
      }
    } finally {
      writer.close();
    }
    const reader = await openEncryptedDatabase(scratch, safeStorage);
    try {
      const value = reader.prepare<[], { value: string }>(
        "SELECT value FROM settings WHERE key = 'diagnostic'",
      ).get()?.value;
      const entries = reader.prepare<[], ReturnType<typeof appendAudit>>(
        'SELECT * FROM audit_log ORDER BY id',
      ).all();
      if (value !== 'passed' || !verifyAuditChain(entries, head)) {
        throw new Error('Encrypted database readback did not match the write');
      }
    } finally {
      reader.close();
    }
    const path = join(scratch, 'courtplus.sqlite3');
    const plain = new Database(path, { readonly: true, fileMustExist: true });
    try {
      plain.prepare('SELECT name FROM sqlite_master').all();
      throw new Error('Database could be read without a key');
    } catch (error) {
      if (!(error instanceof Database.SqliteError) || error.code !== 'SQLITE_NOTADB') throw error;
    } finally {
      plain.close();
    }
    return 'DPAPI key persisted, SQLCipher write/reopen/read passed, keyless read rejected, audit chain verified';
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function runIdentity(
  ort: Pick<typeof Ort, 'InferenceSession' | 'Tensor'>,
  model: Uint8Array,
  provider: 'cpu' | 'wasm',
): Promise<void> {
  const inference = await ort.InferenceSession.create(model, { executionProviders: [provider] });
  try {
    const result = await inference.run({ input: new ort.Tensor('float32', Float32Array.of(23), [1]) });
    if (result.output?.data[0] !== 23) throw new Error('Identity model output did not equal its input');
  } finally {
    await inference.release();
  }
}

async function checkOnnx(): Promise<string> {
  const model = readFileSync(join(diagnosticResources(), 'identity.onnx'));
  try {
    const ort = await import('onnxruntime-node');
    await runIdentity(ort, model, 'cpu');
    return 'onnxruntime-node CPU identity inference returned 23';
  } catch (nativeError) {
    try {
      const ort = await import('onnxruntime-web');
      ort.env.wasm.numThreads = 1;
      await runIdentity(ort, model, 'wasm');
      return `onnxruntime-web WASM identity inference returned 23. Native failure: ${describe(nativeError)}`;
    } catch (wasmError) {
      throw new Error(`Native: ${describe(nativeError)}. WASM: ${describe(wasmError)}`);
    }
  }
}

async function checkPdf(directory: string, rendererSession: Session): Promise<string> {
  const window = new BrowserWindow({ show: false, webPreferences: { ...webPreferences, session: rendererSession } });
  lockDownWindow(window);
  try {
    await window.loadURL(pdfUrl);
    const textLoaded: unknown = await window.webContents.executeJavaScript(
      "document.fonts.ready.then(() => document.body.textContent.includes('देवनागरी न्याय परीक्षण'))",
    );
    if (textLoaded !== true) throw new Error('The Devanagari sample page did not load');
    const pdf = await window.webContents.printToPDF({ pageSize: 'A4', printBackground: true });
    if (pdf.subarray(0, 5).toString('ascii') !== '%PDF-' || pdf.byteLength < 1_000) {
      throw new Error('printToPDF did not produce a PDF');
    }
    const path = join(directory, 'diagnostics-devanagari.pdf');
    writeFileSync(path, pdf);
    return `printToPDF produced ${pdf.byteLength} bytes at ${path}`;
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

export async function runDiagnostics(directory: string, rendererSession: Session): Promise<DiagnosticsReport> {
  const [sqlcipher, onnx, devanagariPdf] = await Promise.all([
    check(() => timeStartup('diagnostic SQLCipher', () => checkSqlCipher(directory))),
    check(() => timeStartup('diagnostic ONNX', checkOnnx)),
    check(() => timeStartup('diagnostic Devanagari PDF', () => checkPdf(directory, rendererSession))),
  ]);
  const report = {
    timestamp: new Date().toISOString(),
    packaged: app.isPackaged,
    electron: process.versions.electron,
    platform: process.platform,
    architecture: process.arch,
    portable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE),
    sqlcipher,
    onnx,
    devanagariPdf,
  };
  writeFileSync(join(directory, 'diagnostics.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

export function diagnosticsPassed(report: DiagnosticsReport): boolean {
  return report.sqlcipher.ok && report.onnx.ok && report.devanagariPdf.ok;
}
