// Minimaler OpenAI-kompatibler Mock-LLM-Server für die lokale Entwicklung
// ohne echten LiteLLM-Proxy (npm run dev:demo).
//
// Verhalten:
// - Fragen mit "filter"          → Tool-Call get_filters
// - Fragen mit "umsatz"/"daten"/"zeile" → Tool-Call get_worksheet_summary_data
// - nach einem Tool-Ergebnis     → Textantwort, die das Ergebnis referenziert
// - sonst                        → gestreamte Textantwort
import http from 'node:http';

const PORT = Number(process.env.MOCK_LLM_PORT ?? 4010);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sse(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

async function streamText(res, text) {
  for (const word of text.split(/(?<= )/)) {
    sse(res, { choices: [{ index: 0, delta: { content: word }, finish_reason: null }] });
    await sleep(25);
  }
  sse(res, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
  sse(res, { choices: [], usage: { prompt_tokens: 120, completion_tokens: 40 } });
}

async function streamToolCall(res, name, args) {
  const argJson = JSON.stringify(args);
  sse(res, {
    choices: [
      {
        index: 0,
        delta: {
          role: 'assistant',
          tool_calls: [{ index: 0, id: `call_${Date.now()}`, type: 'function', function: { name, arguments: '' } }],
        },
        finish_reason: null,
      },
    ],
  });
  // Argumente fragmentiert streamen — wie echte Provider.
  const mid = Math.floor(argJson.length / 2);
  for (const frag of [argJson.slice(0, mid), argJson.slice(mid)]) {
    sse(res, {
      choices: [
        { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: frag } }] }, finish_reason: null },
      ],
    });
    await sleep(20);
  }
  sse(res, { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
  sse(res, { choices: [], usage: { prompt_tokens: 100, completion_tokens: 15 } });
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url?.endsWith('/models')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-model' }, { id: 'mock-model-mini' }] }));
    return;
  }
  if (req.method === 'POST' && req.url?.endsWith('/chat/completions')) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      const parsed = JSON.parse(body);
      const messages = parsed.messages ?? [];
      const last = messages[messages.length - 1] ?? {};
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      const question = (lastUser?.content ?? '').toLowerCase();
      const toolsAllowed = parsed.tool_choice !== 'none';

      // Non-Streaming (z. B. Memory-Fakten-Extraktion): JSON-Completion.
      if (parsed.stream !== true) {
        // Scope-Guard-Klassifikation (erkennbar am Themen-Filter-System-Prompt):
        // "gedicht"/"witz" simulieren Off-Topic, alles andere ist im Scope.
        const systemContent = String(parsed.messages?.[0]?.content ?? '');
        if (systemContent.includes('Themen-Filter')) {
          // Nur die AKTUELLE Frage (<frage>-Block) prüfen — der Prompt enthält
          // auch die vorherige Frage als Kontext, die darf nicht mitmatchen.
          const frageMatch = /<frage>\n?([\s\S]*?)\n?<\/frage>\s*$/.exec(lastUser?.content ?? '');
          const currentQuestion = frageMatch ? frageMatch[1] : (lastUser?.content ?? '');
          const offTopic = /gedicht|witz/i.test(currentQuestion);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              id: 'chatcmpl-mock',
              object: 'chat.completion',
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: offTopic ? 'NEIN' : 'JA' },
                  finish_reason: 'stop',
                },
              ],
              usage: { prompt_tokens: 30, completion_tokens: 1 },
            }),
          );
          return;
        }
        const nameMatch = /(?:ich bin|ich heiße|mein name ist)\s+([A-Za-zÄÖÜäöüß]+)/i.exec(
          lastUser?.content ?? '',
        );
        const facts = nameMatch
          ? [`Heißt ${nameMatch[1]}`, 'Bevorzugt kompakte Tabellen (Demo-Fakt vom Mock-LLM)']
          : ['Bevorzugt kompakte Tabellen (Demo-Fakt vom Mock-LLM)'];
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'chatcmpl-mock',
            object: 'chat.completion',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: JSON.stringify({ facts }) },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 50, completion_tokens: 20 },
          }),
        );
        return;
      }

      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });

      const suggestionsBlock = `\n<suggestions>${JSON.stringify({
        followups: ['Vergleiche Nord und Süd.', 'Was zeigt „Top Produkte"?'],
        actions: [
          {
            type: 'apply_filter',
            worksheet: 'Umsatz nach Region',
            field: 'Region',
            values: ['Süd'],
            label: 'Auf Region Süd filtern',
          },
        ],
      })}</suggestions>`;

      if (last.role === 'tool') {
        const preview = String(last.content ?? '').slice(0, 400);
        await streamText(
          res,
          `**Mock-Antwort** auf Basis des Tool-Ergebnisses:\n\n${preview}\n\n_(Dies ist der Mock-LLM-Server — echte Analysen liefert erst der richtige LLM-Endpunkt.)_${suggestionsBlock}`,
        );
      } else if (toolsAllowed && question.includes('filter')) {
        await streamToolCall(res, 'get_filters', {});
      } else if (toolsAllowed && /(vergleich|aggregier|top|pro region|pro produkt)/.test(question)) {
        await streamToolCall(res, 'aggregate_summary_data', {
          worksheet: 'Auftragsdetails',
          groupBy: ['Region'],
          measures: [
            { column: 'SUM(Umsatz)', agg: 'sum' },
            { column: 'SUM(Umsatz)', agg: 'count' },
          ],
        });
      } else if (toolsAllowed && /(umsatz|daten|zeile|tabelle)/.test(question)) {
        await streamToolCall(res, 'get_worksheet_summary_data', {
          worksheet: 'Umsatz nach Region',
          maxRows: 10,
        });
      } else {
        await streamText(
          res,
          `Mock-Antwort auf: „${lastUser?.content ?? '?'}“ — frage z. B. nach *Filtern* oder *Umsatzdaten*, um Tool-Calling zu sehen.${suggestionsBlock}`,
        );
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });
    return;
  }
  res.writeHead(404).end();
});

server.listen(PORT, () => {
  console.log(`Mock-LLM-Server läuft auf http://localhost:${PORT} (Modelle: mock-model)`);
});
