import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Night } from '../src/digest/types.js';

describe('digest routes', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'rig-runs-'));

  it('GET /digest/:night with file → 200, contains "digest <night>", rows in tbody with warn class for retry>=3 or fail status', async () => {
    const night = '2026-10-30';
    const jsonl = [
      '{"at":"2026-10-30T00:00:00+01:00","job":"a/first","status":"ok","owner":"rook"}',
      '{"at":"2026-10-30T00:05:00+01:00","job":"a/first","status":"retry","owner":"rook"}',
      '{"at":"2026-10-30T00:10:00+01:00","job":"a/first","status":"retry","owner":"rook"}',
      '{"at":"2026-10-30T00:15:00+01:00","job":"a/first","status":"retry","owner":"rook"}',
      '{"at":"2026-10-30T00:20:00+01:00","job":"b/second","status":"fail","owner":"alice"}',
      '{"at":"2026-10-30T00:25:00+01:00","job":"c/third","status":"ok","owner":null}',
    ].join('\n');
    writeFileSync(join(tempDir, `${night}.jsonl`), jsonl);

    const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: tempDir };
    const res = await createApp(config).request(`/digest/${night}`);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain(`digest ${night}`);
    expect(html).toContain('<tbody>');
    expect(html).toContain('<thead>');

    const trMatches = html.match(/<tr[^>]*>/g) || [];
    expect(trMatches.length).toBeGreaterThanOrEqual(4); // 1 header + 3 jobs

    expect(html).toContain('class="warn"'); // for retry>=3 or fail
  });

  it('GET /digest/:night with no file → 404, body contains "no run log for <night>"', async () => {
    const night = '2026-01-01';
    const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: tempDir };
    const res = await createApp(config).request(`/digest/${night}`);
    const html = await res.text();

    expect(res.status).toBe(404);
    expect(html).toContain(`no run log for ${night}`);
  });

  it('GET /digest/:night with empty file → 200, contains "nothing ran"', async () => {
    const night = '2026-10-31';
    writeFileSync(join(tempDir, `${night}.jsonl`), '');

    const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: tempDir };
    const res = await createApp(config).request(`/digest/${night}`);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
  });

  it('GET /digest/:night with bad line → 200, good rows shown, contains "1 line(s) did not parse"', async () => {
    const night = '2026-11-01';
    const jsonl = [
      '{"at":"2026-11-01T00:00:00+01:00","job":"x/job","status":"ok","owner":"rook"}',
      'this is not valid json',
      '{"at":"2026-11-01T00:05:00+01:00","job":"y/job","status":"ok","owner":"alice"}',
    ].join('\n');
    writeFileSync(join(tempDir, `${night}.jsonl`), jsonl);

    const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: tempDir };
    const res = await createApp(config).request(`/digest/${night}`);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('1 line(s) did not parse');
    expect(html).toContain('<tbody>');
    expect(html).toContain('x/job');
    expect(html).toContain('y/job');
  });

  it('GET /api/digest/:night with file → 200, JSON deep-equals readNight result', async () => {
    const night = '2026-11-02';
    const jsonl = [
      '{"at":"2026-11-02T00:00:00+01:00","job":"a/job","status":"ok","owner":"rook"}',
      '{"at":"2026-11-02T00:05:00+01:00","job":"b/job","status":"fail","owner":"alice","error":"timeout"}',
    ].join('\n');
    writeFileSync(join(tempDir, `${night}.jsonl`), jsonl);

    const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: tempDir };
    const res = await createApp(config).request(`/api/digest/${night}`);
    const json = await res.json() as Night;

    expect(res.status).toBe(200);
    expect(json.night).toBe(night);
    expect(json.rows).toHaveLength(2);
    expect(json.badLines).toBe(0);
    expect(json.rows.map((r) => r.job).sort()).toEqual(['a/job', 'b/job']);
  });

  it('GET /api/digest/:night with no file → 404, JSON has error and night', async () => {
    const night = '2026-01-02';
    const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: tempDir };
    const res = await createApp(config).request(`/api/digest/${night}`);
    const json = await res.json() as { error: string; night: string };

    expect(res.status).toBe(404);
    expect(json.error).toBe('no run log');
    expect(json.night).toBe(night);
  });

  it('GET /api/digest/:night with empty file → 200, rows: [], badLines: 0', async () => {
    const night = '2026-11-03';
    writeFileSync(join(tempDir, `${night}.jsonl`), '');

    const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: tempDir };
    const res = await createApp(config).request(`/api/digest/${night}`);
    const json = await res.json() as Night;

    expect(res.status).toBe(200);
    expect(json.night).toBe(night);
    expect(json.rows).toEqual([]);
    expect(json.badLines).toBe(0);
  });

  it('GET /api/digest/:night with bad line → 200, badLines: 1, good rows kept', async () => {
    const night = '2026-11-04';
    const jsonl = [
      '{"at":"2026-11-04T00:00:00+01:00","job":"m/job","status":"ok","owner":"rook"}',
      'truncated{',
      '{"at":"2026-11-04T00:05:00+01:00","job":"n/job","status":"ok","owner":"alice"}',
    ].join('\n');
    writeFileSync(join(tempDir, `${night}.jsonl`), jsonl);

    const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: tempDir };
    const res = await createApp(config).request(`/api/digest/${night}`);
    const json = await res.json() as Night;

    expect(res.status).toBe(200);
    expect(json.badLines).toBe(1);
    expect(json.rows).toHaveLength(2);
    expect(json.rows.map((r) => r.job).sort()).toEqual(['m/job', 'n/job']);
  });

  it('page and JSON agree: same job names, same order', async () => {
    const night = '2026-11-05';
    const jsonl = [
      '{"at":"2026-11-05T00:00:00+01:00","job":"z/last","status":"ok","owner":"rook"}',
      '{"at":"2026-11-05T00:05:00+01:00","job":"a/first","status":"ok","owner":"alice"}',
      '{"at":"2026-11-05T00:10:00+01:00","job":"m/middle","status":"ok","owner":"bob"}',
    ].join('\n');
    writeFileSync(join(tempDir, `${night}.jsonl`), jsonl);

    const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: tempDir };

    const htmlRes = await createApp(config).request(`/digest/${night}`);
    const htmlText = await htmlRes.text();

    const jsonRes = await createApp(config).request(`/api/digest/${night}`);
    const jsonData = await jsonRes.json() as Night;

    const pageJobs: string[] = [];
    const jobRegex = /<tbody>[\s\S]*?<\/tbody>/;
    const tbodyMatch = htmlText.match(jobRegex);
    if (tbodyMatch) {
      const trRegex = /<tr[^>]*>[\s\S]*?<td[^>]*>([\w/]+)<\/td>/g;
      let match;
      while ((match = trRegex.exec(tbodyMatch[0])) !== null) {
        pageJobs.push(match[1]);
      }
    }

    const jsonJobs = jsonData.rows.map((r) => r.job);

    expect(pageJobs).toEqual(jsonJobs);
    expect(pageJobs).toEqual(['a/first', 'm/middle', 'z/last']);
  });
});
