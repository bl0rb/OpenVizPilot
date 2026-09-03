// OpenAI-kompatibler Shim, der /chat/completions an die lokal angemeldete
// Claude Code CLI (`claude -p`) weiterreicht — Antworten laufen über das
// Claude-Abo des Users, KEIN API-Key nötig. Nur für lokales Testen gedacht
// (ein CLI-Prozess pro Request, mehrere Sekunden Latenz).
//
// Start:  node packages/server/scripts/claude-code-llm.mjs   (Port 4020)
// Nutzung: LITELLM_BASE_URL=http://localhost:4020 in .env
//
// Tool-Calling wird emuliert: Die OpenAI-Tool-Schemas werden in den
// System-Prompt übersetzt; ruft das Modell ein Tool, antwortet es mit
// <tool_call>{...}</tool_call>-Blöcken, die hier in OpenAI-tool_calls
// zurückübersetzt werden.
import { spawn } from 'node:child_process';
import http from 'node:http';

const PORT = Number(process.env.CLAUDE_LLM_PORT ?? 4020);
const CLI_TIMEOUT_MS = 180_000;
const MODELS = ['sonnet', 'opus', 'haiku'];

function mapModel(model) {
  return MODELS.includes(model) ? model : 'sonnet';
}

function buildSystemPrompt(messages, tools, toolChoice) {
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  const parts = [
    system,
    '\n\nDu läufst als reiner Text-Assistent über die Claude-CLI: Benutze KEINE eigenen Werkzeuge (kein Bash, keine Dateien) und stelle keine Rückfragen — antworte direkt.',
  ];
  if (Array.isArray(tools) && tools.length > 0 && toolChoice !== 'none') {
    parts.push(
      `\nDir stehen folgende Funktions-Tools zur Verfügung (JSON-Schemas):\n${JSON.stringify(
        tools.map((t) => t.function),
        null,
        2,
      )}\n\nWenn du eines oder mehrere Tools aufrufen willst, antworte AUSSCHLIESSLICH mit einem <tool_call>-Block pro Aufruf und sonst NICHTS:\n<tool_call>{"name":"tool_name","arguments":{...}}</tool_call>\nWenn du genug Informationen hast, antworte stattdessen normal als Text (dann keine <tool_call>-Blöcke).`,
    );
  } else {
    parts.push('\nRufe in dieser Antwort KEINE Tools auf — antworte als Text.');
  }
  return parts.join('');
}

function buildPrompt(messages) {
  const lines = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'user') {
      lines.push(`[USER]\n${m.content}`);
    } else if (m.role === 'assistant') {
      const calls = (m.tool_calls ?? [])
        .map((t) => `<tool_call>{"name":"${t.function.name}","arguments":${t.function.arguments}}</tool_call>`)
        .join('\n');
      lines.push(`[ASSISTANT]\n${[m.content, calls].filter(Boolean).join('\n')}`);
    } else if (m.role === 'tool') {
      lines.push(`[TOOL-ERGEBNIS]\n${m.content}`);
    }
  }
  lines.push('[ASSISTANT]');
  return lines.join('\n\n');
}

function runClaude(prompt, systemPrompt, model) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      '--output-format', 'json',
      '--model', mapModel(model),
      '--system-prompt', systemPrompt,
      '--strict-mcp-config',
      '--mcp-config', '{"mcpServers":{}}',
      '--disallowedTools', '*',
    ];
    const child = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Claude-CLI-Timeout'));
    }, CLI_TIMEOUT_MS);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude exit ${code}: ${stderr.slice(0, 300)}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.is_error) {
          reject(new Error(String(parsed.result ?? 'CLI-Fehler').slice(0, 300)));
          return;
        }
        resolve(String(parsed.result ?? ''));
      } catch {
        reject(new Error(`CLI-Output nicht parsebar: ${stdout.slice(0, 200)}`));
      }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/** Extrahiert <tool_call>-Blöcke → OpenAI-tool_calls; Rest bleibt Text. */
function parseToolCalls(text) {
  const toolCalls = [];
  const cleaned = text
    .replace(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g, (_, json) => {
      try {
        const call = JSON.parse(json);
        if (typeof call.name === 'string') {
          toolCalls.push({
            index: toolCalls.length,
            id: `call_${toolCalls.length + 1}`,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
          });
        }
      } catch {
        // kaputter Block → als Text belassen wäre verwirrend, einfach verwerfen
      }
      return '';
    })
    .trim();
  return { text: cleaned, toolCalls };
}

function sse(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url?.endsWith('/models')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: MODELS.map((id) => ({ id })) }));
    return;
  }
  if (req.method === 'POST' && req.url?.endsWith('/chat/completions')) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'invalid json' } }));
        return;
      }
      const { model, messages = [], tools, tool_choice: toolChoice, stream } = parsed;
      const systemPrompt = buildSystemPrompt(messages, tools, toolChoice);
      const prompt = buildPrompt(messages);

      let raw;
      try {
        console.log(`→ claude -p (${mapModel(model)}, ${messages.length} messages)`);
        raw = await runClaude(prompt, systemPrompt, model);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`✗ ${message}`);
        if (stream === true) {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          sse(res, { error: { message } });
          res.write('data: [DONE]\n\n');
          res.end();
        } else {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message } }));
        }
        return;
      }

      const { text, toolCalls } = parseToolCalls(raw);
      console.log(`← ${toolCalls.length > 0 ? `${toolCalls.length} tool_call(s)` : `${text.length} Zeichen Text`}`);

      if (stream !== true) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'chatcmpl-claude-code',
            object: 'chat.completion',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: text || null,
                  ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
                },
                finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
              },
            ],
          }),
        );
        return;
      }

      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      if (toolCalls.length > 0) {
        if (text) {
          sse(res, { choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });
        }
        sse(res, { choices: [{ index: 0, delta: { role: 'assistant', tool_calls: toolCalls }, finish_reason: null }] });
        sse(res, { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
      } else {
        // In handliche Deltas zerlegen, damit die UI streamt statt zu springen.
        for (let i = 0; i < text.length; i += 80) {
          sse(res, { choices: [{ index: 0, delta: { content: text.slice(i, i + 80) }, finish_reason: null }] });
        }
        sse(res, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });
    return;
  }
  res.writeHead(404).end();
});

server.listen(PORT, () => {
  console.log(`Claude-Code-LLM-Shim läuft auf http://localhost:${PORT} (Modelle: ${MODELS.join(', ')})`);
  console.log('Antworten laufen über die lokal angemeldete Claude-CLI — kein API-Key.');
});
