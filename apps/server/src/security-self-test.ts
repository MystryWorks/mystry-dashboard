import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';

function makeStoredZip(name: string, content: Buffer): Buffer {
  const nameBuffer = Buffer.from(name, 'utf8');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(content.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(nameBuffer.length, 26);
  const localRecord = Buffer.concat([local, nameBuffer, content]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt32LE(content.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(nameBuffer.length, 28);
  const centralRecord = Buffer.concat([central, nameBuffer]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralRecord.length, 12);
  eocd.writeUInt32LE(localRecord.length, 16);
  return Buffer.concat([localRecord, centralRecord, eocd]);
}

async function main(): Promise<void> {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mmd-security-self-test-'));
  process.env.DATA_DIR = dataRoot;
  process.env.JWT_SECRET = 'a'.repeat(64);
  process.env.SETUP_TOKEN = 'b'.repeat(64);
  process.env.LAUNCHER_TOKEN = 'c'.repeat(64);
  process.env.MAX_CONCURRENT_UPLOADS = '1';
  process.env.MAX_UPLOAD_BYTES = '256';
  process.env.MAX_CONCURRENT_FILE_DOWNLOADS = '1';
  process.env.MAX_COMMAND_BYTES = '4';

  const { config } = await import('./config.js');
  const { getDb } = await import('./db.js');
  const { buildApp } = await import('./index.js');
  const { consumeConsoleTicket, issueConsoleTicket } = await import('./services/console-ticket-service.js');
  const { safeExtract } = await import('./services/import-service.js');
  const {
    removeUploadTemp,
    streamToUploadTemp,
    UploadTooLargeError,
  } = await import('./services/upload-service.js');
  const { getMinecraftChildEnv } = await import('./utils/child-env.js');
  const { acquireFileDownloadSlot } = await import('./services/file-service.js');
  const { registerStdinSafetyHandlers } = await import('./services/process-manager.js');
  const { defaultInstanceDir, readOwnershipMarker, resolveSafePath } = await import('./utils/path.js');

  let launcherShutdownStarted = false;
  const app = await buildApp({
    prepareShutdown: () => ({
      runningInstances: 0,
      runningTasks: 0,
      queuedTasks: 0,
      alreadyShuttingDown: false,
    }),
    startShutdown: () => {
      launcherShutdownStarted = true;
    },
  });
  const testRoot = fs.mkdtempSync(path.join(config.uploadDir, '.security-self-test-'));
  try {
    assert.throws(() => resolveSafePath(testRoot, '../outside'), /非法路径/);
    assert.equal(getMinecraftChildEnv().JWT_SECRET, undefined);

    const setup = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      headers: { 'x-setup-token': 'b'.repeat(64) },
      payload: { username: 'admin12', password: 'password1234' },
    });
    assert.equal(setup.statusCode, 200);
    const accessToken = setup.json<{ token: string }>().token;
    const authorization = { authorization: `Bearer ${accessToken}` };

    const createWithLegacyField = await app.inject({
      method: 'POST',
      url: '/api/instances',
      headers: authorization,
      payload: { name: 'legacy-create', javaPath: 'java' },
    });
    assert.equal(createWithLegacyField.statusCode, 400);

    const deployWithLegacyField = await app.inject({
      method: 'POST',
      url: '/api/cores/deploy',
      headers: authorization,
      payload: {
        name: 'legacy-deploy',
        coreType: 'paper',
        mcVersion: '1.20.1',
        installPath: 'C:/legacy',
      },
    });
    assert.equal(deployWithLegacyField.statusCode, 400);

    const legacyCopyId = 'legacy-copy';
    const legacyCopyDir = defaultInstanceDir(legacyCopyId);
    const legacyExternalDir = path.join(dataRoot, 'legacy-external');
    fs.mkdirSync(legacyCopyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyCopyDir, 'server.jar'), 'copied');
    fs.mkdirSync(legacyExternalDir, { recursive: true });
    fs.writeFileSync(path.join(legacyExternalDir, 'do-not-touch'), 'sentinel');
    const legacyNow = new Date().toISOString();
    getDb().prepare(
      `INSERT INTO instances
       (id, name, core_type, mc_version, jar_file, java_path, jvm_args, accept_eula, install_path, ownership_marker, node_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      legacyCopyId,
      'legacy-copy',
      'custom',
      null,
      'server.jar',
      'java',
      '-Xms1G -Xmx2G',
      0,
      legacyExternalDir,
      null,
      'local',
      legacyNow,
      legacyNow,
    );
    const adoptedLegacy = await app.inject({
      method: 'POST',
      url: `/api/instances/${legacyCopyId}/adopt-managed-directory`,
      headers: authorization,
    });
    assert.equal(adoptedLegacy.statusCode, 200);
    assert.equal(readOwnershipMarker(legacyCopyId, legacyCopyDir) !== null, true);
    assert.equal(fs.readFileSync(path.join(legacyExternalDir, 'do-not-touch'), 'utf8'), 'sentinel');

    const invalidMarkerId = 'invalid-marker';
    const invalidMarkerDir = defaultInstanceDir(invalidMarkerId);
    const invalidExternalDir = path.join(dataRoot, 'invalid-external');
    fs.mkdirSync(invalidMarkerDir, { recursive: true });
    fs.writeFileSync(path.join(invalidMarkerDir, 'server.jar'), 'copied');
    fs.writeFileSync(
      path.join(invalidMarkerDir, '.mmd-instance.json'),
      `${JSON.stringify({ version: 1, instanceId: 'another-instance', marker: 'foreign' })}\n`,
    );
    const invalidNow = new Date().toISOString();
    getDb().prepare(
      `INSERT INTO instances
       (id, name, core_type, mc_version, jar_file, java_path, jvm_args, accept_eula, install_path, ownership_marker, node_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      invalidMarkerId,
      'invalid-marker',
      'custom',
      null,
      'server.jar',
      'java',
      '-Xms1G -Xmx2G',
      0,
      invalidExternalDir,
      null,
      'local',
      invalidNow,
      invalidNow,
    );
    const rejectedInvalidMarker = await app.inject({
      method: 'POST',
      url: `/api/instances/${invalidMarkerId}/adopt-managed-directory`,
      headers: authorization,
    });
    assert.equal(rejectedInvalidMarker.statusCode, 400);
    assert.equal(
      (getDb().prepare('SELECT install_path FROM instances WHERE id = ?').get(invalidMarkerId) as { install_path: string }).install_path,
      invalidExternalDir,
    );

    const shortLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'abcdef', password: 'abcdef' },
    });
    assert.equal(shortLogin.statusCode, 401);

    const ticket = issueConsoleTicket('user', 'instance');
    assert.equal(consumeConsoleTicket(ticket.ticket, 'instance')?.userId, 'user');
    assert.equal(consumeConsoleTicket(ticket.ticket, 'instance'), null);

    const uploaded = await streamToUploadTemp(Readable.from([Buffer.from('streamed')]), 'test');
    assert.equal(fs.readFileSync(uploaded, 'utf8'), 'streamed');
    removeUploadTemp(uploaded);

    await assert.rejects(
      () => streamToUploadTemp(Readable.from([Buffer.alloc(config.maxUploadBytes + 1)]), 'too-large'),
      (error: unknown) => error instanceof UploadTooLargeError,
    );

    const stdin = new PassThrough();
    const stdinState = { stdinAvailable: true, stdinBackpressured: false };
    registerStdinSafetyHandlers(stdin, stdinState);
    let uncaughtStdinError: unknown = null;
    const onUncaughtStdinError = (error: unknown) => {
      uncaughtStdinError = error;
    };
    process.once('uncaughtException', onUncaughtStdinError);
    try {
      const stdinClosed = new Promise<void>((resolve) => stdin.once('close', resolve));
      stdin.destroy(new Error('EPIPE'));
      await stdinClosed;
      await new Promise<void>((resolve) => setImmediate(resolve));
    } finally {
      process.off('uncaughtException', onUncaughtStdinError);
    }
    assert.equal(uncaughtStdinError, null);
    assert.equal(stdinState.stdinAvailable, false);
    assert.equal(stdinState.stdinBackpressured, true);

    let releaseUpload!: () => void;
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    const slowUpload = streamToUploadTemp(
      Readable.from((async function* () {
        await uploadGate;
        yield Buffer.from('slow');
      })()),
      'capacity',
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    const uploadInstance = await app.inject({
      method: 'POST',
      url: '/api/instances',
      headers: authorization,
      payload: { name: 'upload-capacity' },
    });
    assert.equal(uploadInstance.statusCode, 200);
    const uploadInstanceId = uploadInstance.json<{ id: string }>().id;
    fs.writeFileSync(path.join(defaultInstanceDir(uploadInstanceId), 'download.txt'), 'download');
    const boundary = 'mmd-security-test-boundary';
    const multipartPayload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.txt"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      Buffer.from('full'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const uploadWhileFull = await app.inject({
      method: 'POST',
      url: `/api/instances/${uploadInstanceId}/files/upload`,
      headers: {
        ...authorization,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: multipartPayload,
    });
    assert.equal(uploadWhileFull.statusCode, 429);
    await assert.rejects(
      () => streamToUploadTemp(Readable.from([Buffer.from('full')]), 'capacity'),
      (error: unknown) => error !== null
        && typeof error === 'object'
        && 'code' in error
        && error.code === 'UPLOAD_CAPACITY',
    );
    releaseUpload();
    removeUploadTemp(await slowUpload);

    const oversizedBoundary = 'mmd-security-test-oversized-boundary';
    const oversizedMultipartPayload = Buffer.concat([
      Buffer.from(`--${oversizedBoundary}\r\nContent-Disposition: form-data; name="file"; filename="too-large.txt"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      Buffer.alloc(config.maxUploadBytes + 1, 0x61),
      Buffer.from(`\r\n--${oversizedBoundary}--\r\n`),
    ]);
    const oversizedUpload = await app.inject({
      method: 'POST',
      url: `/api/instances/${uploadInstanceId}/files/upload`,
      headers: {
        ...authorization,
        'content-type': `multipart/form-data; boundary=${oversizedBoundary}`,
      },
      payload: oversizedMultipartPayload,
    });
    assert.equal(oversizedUpload.statusCode, 413);

    const releaseDownload = acquireFileDownloadSlot();
    try {
      const downloadWhileFull = await app.inject({
        method: 'GET',
        url: `/api/instances/${uploadInstanceId}/files/download?path=download.txt`,
        headers: authorization,
      });
      assert.equal(downloadWhileFull.statusCode, 429);
    } finally {
      releaseDownload();
    }

    const protectedInstance = await app.inject({
      method: 'POST',
      url: '/api/instances',
      headers: authorization,
      payload: { name: 'protected-files' },
    });
    assert.equal(protectedInstance.statusCode, 200);
    const protectedInstanceId = protectedInstance.json<{ id: string }>().id;
    const protectedRoot = defaultInstanceDir(protectedInstanceId);
    const markerPath = path.join(protectedRoot, '.mmd-instance.json');
    const markerBefore = fs.readFileSync(markerPath, 'utf8');
    const deleteRoot = await app.inject({
      method: 'DELETE',
      url: `/api/instances/${protectedInstanceId}/files?path=foo%2F..`,
      headers: authorization,
    });
    assert.equal(deleteRoot.statusCode, 400);
    assert.equal(fs.existsSync(protectedRoot), true);
    const writeMarker = await app.inject({
      method: 'PUT',
      url: `/api/instances/${protectedInstanceId}/files/content`,
      headers: authorization,
      payload: { path: 'nested/../.mmd-instance.json', content: 'tampered' },
    });
    assert.equal(writeMarker.statusCode, 400);
    assert.equal(fs.readFileSync(markerPath, 'utf8'), markerBefore);

    const commandLimit = await app.inject({
      method: 'POST',
      url: `/api/instances/${protectedInstanceId}/command`,
      headers: authorization,
      payload: { command: '12345' },
    });
    assert.equal(commandLimit.statusCode, 400);

    const zipPath = path.join(testRoot, 'safe.zip');
    fs.writeFileSync(zipPath, makeStoredZip('server.jar', Buffer.from('jar')));
    const extracted = path.join(testRoot, 'extracted');
    await safeExtract(zipPath, extracted);
    assert.equal(fs.readFileSync(path.join(extracted, 'server.jar'), 'utf8'), 'jar');

    const badZipPath = path.join(testRoot, 'bad.zip');
    fs.writeFileSync(badZipPath, makeStoredZip('../escape.txt', Buffer.from('nope')));
    const badExtracted = path.join(testRoot, 'bad-extracted');
    await assert.rejects(() => safeExtract(badZipPath, badExtracted), /不安全的 zip 路径/);
    assert.equal(fs.existsSync(path.join(testRoot, 'escape.txt')), false);

    const missingLauncherToken = await app.inject({
      method: 'POST',
      url: '/api/launcher/shutdown',
    });
    assert.equal(missingLauncherToken.statusCode, 401);

    const remoteLauncherShutdown = await app.inject({
      method: 'POST',
      url: '/api/launcher/shutdown',
      remoteAddress: '192.0.2.10',
      headers: { 'x-launcher-token': 'c'.repeat(64) },
    });
    assert.equal(remoteLauncherShutdown.statusCode, 403);

    const launcherShutdown = await app.inject({
      method: 'POST',
      url: '/api/launcher/shutdown',
      headers: { 'x-launcher-token': 'c'.repeat(64) },
    });
    assert.equal(launcherShutdown.statusCode, 202);
    assert.equal(launcherShutdown.json<{ accepted: boolean }>().accepted, true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(launcherShutdownStarted, true);
  } finally {
    await app.close();
    getDb().close();
    fs.rmSync(testRoot, { recursive: true, force: true });
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
  console.log('安全止血自检通过');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
