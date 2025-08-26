const vscode = require('vscode');
const http = require('http');
const https = require('https');
const { URL } = require('url');

function postJson(baseUrl, path, body, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, baseUrl);
    const data = Buffer.from(JSON.stringify(body));
    const isHttps = u.protocol === 'https:';
    const options = {
      method: 'POST',
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + (u.search || ''),
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };
    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }
    const req = (isHttps ? https : http).request(options, res => {
      let chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const txt = buf.toString('utf8');
        try {
          const json = JSON.parse(txt || '{}');
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${txt}`));
          }
        } catch (e) {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve({});
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${txt}`));
          }
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function ingestSchema(context) {
  const cfg = vscode.workspace.getConfiguration('zonecog.bridge');
  const baseUrl = cfg.get('baseUrl') || 'http://127.0.0.1:7807';
  const token = cfg.get('authToken') || '';
  const input = await vscode.window.showInputBox({ prompt: 'Enter schema JSON for ingestion (tables, foreign_keys)', validateInput: v => v ? undefined : 'Required' });
  if (!input) { return; }
  let parsed;
  try {
    parsed = JSON.parse(input);
  } catch {
    vscode.window.showErrorMessage('Invalid JSON');
    return;
  }
  const task = vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Zone-Cog: Ingesting Schema', cancellable: false }, async () => {
    const res = await postJson(baseUrl, '/ingest/schema', parsed, token);
    vscode.window.showInformationMessage(`Schema ingest result: ${JSON.stringify(res)}`);
  });
  await task;
}

async function ingestActiveTable(context) {
  const cfg = vscode.workspace.getConfiguration('zonecog.bridge');
  const baseUrl = cfg.get('baseUrl') || 'http://127.0.0.1:7807';
  const token = cfg.get('authToken') || '';
  const schema = await vscode.window.showInputBox({ prompt: 'Schema (optional)' });
  const table = await vscode.window.showInputBox({ prompt: 'Table name', validateInput: v => v ? undefined : 'Required' });
  if (!table) { return; }
  const pk = await vscode.window.showInputBox({ prompt: 'Primary key column(s) comma-separated', validateInput: v => v ? undefined : 'Required' });
  if (!pk) { return; }
  const rowsJson = await vscode.window.showInputBox({ prompt: 'Rows JSON array [{"col":"val",...},...]', validateInput: v => v ? undefined : 'Required' });
  if (!rowsJson) { return; }
  let rows;
  try {
    rows = JSON.parse(rowsJson);
  } catch {
    vscode.window.showErrorMessage('Invalid rows JSON');
    return;
  }
  const primaryKey = pk.includes(',') ? pk.split(',').map(s => s.trim()).filter(Boolean) : pk.trim();
  const payload = { schema: schema || null, table, primary_key: primaryKey, rows };
  const task = vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Zone-Cog: Ingesting Table', cancellable: false }, async () => {
    const res = await postJson(baseUrl, '/ingest/table', payload, token);
    vscode.window.showInformationMessage(`Table ingest result: ${JSON.stringify(res)}`);
  });
  await task;
}

async function runCognitiveAnalysis(context) {
  const cfg = vscode.workspace.getConfiguration('zonecog.bridge');
  const baseUrl = cfg.get('baseUrl') || 'http://127.0.0.1:7807';
  const token = cfg.get('authToken') || '';
  const atomsJson = await vscode.window.showInputBox({ prompt: 'Atoms JSON batch {"nodes":[...],"links":[...]}', validateInput: v => v ? undefined : 'Required' });
  if (!atomsJson) { return; }
  let atoms;
  try {
    atoms = JSON.parse(atomsJson);
  } catch {
    vscode.window.showErrorMessage('Invalid atoms JSON');
    return;
  }
  const mode = await vscode.window.showInputBox({ prompt: 'Cognitive mode (optional)' });
  const payload = { atoms, mode: mode || null, context: {} };
  const task = vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Zone-Cog: Running Cognitive Analysis', cancellable: false }, async () => {
    const res = await postJson(baseUrl, '/reason', payload, token);
    vscode.window.showInformationMessage(`Cognitive result: ${JSON.stringify(res)}`);
  });
  await task;
}

function activate(context) {
  context.subscriptions.push(vscode.commands.registerCommand('zonecog.ingestSchema', () => ingestSchema(context)));
  context.subscriptions.push(vscode.commands.registerCommand('zonecog.ingestActiveTable', () => ingestActiveTable(context)));
  context.subscriptions.push(vscode.commands.registerCommand('zonecog.runCognitiveAnalysis', () => runCognitiveAnalysis(context)));
}

function deactivate() {}

module.exports = { activate, deactivate };
