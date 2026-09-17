import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const port = Number(process.env.PORT || 3000);
const root = process.cwd();
try {
  const envFile = await readFile(join(root, '.env'), 'utf8');
  envFile.split(/\r?\n/).forEach(line => {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  });
} catch { /* .env is optional; deployment environments normally inject variables. */ }
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8' };
const allowedTypes = ['text','email','tel','url','number','textarea','select','checkbox','radio','acceptance','date'];

function send(res, status, data) { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(data)); }
function sanitizeField(field, index) {
  const type = allowedTypes.includes(field.type) ? field.type : 'text';
  return {
    type,
    name: String(field.name || `field-${index + 1}`).toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-'),
    label: String(field.label || '입력 항목').slice(0, 80),
    placeholder: String(field.placeholder || '').slice(0, 120),
    options: ['select','checkbox','radio'].includes(type) ? String(field.options || '선택지 1, 선택지 2').slice(0, 300) : '',
    required: Boolean(field.required),
    phoneFormat: type === 'tel' && Boolean(field.phoneFormat)
  };
}

async function generateForm(prompt) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY가 설정되지 않았습니다. .env.example을 참고해 API 키를 설정하세요.');
  const instructions = `You design Korean Contact Form 7 forms. Reply with JSON only, with this exact shape: {"title":"string","fields":[{"type":"text|email|tel|url|number|textarea|select|checkbox|radio|acceptance|date","name":"ascii-kebab-case","label":"Korean label","placeholder":"Korean placeholder","options":"comma-separated options only for select/checkbox/radio","required":true,"phoneFormat":false}]}. Create 3-8 useful fields. Use phoneFormat true only for Korean mobile or phone fields. Include an acceptance field only when the request asks for consent or personal information collection. No markdown.`;
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-5', instructions, input: prompt, temperature: 0.2, max_output_tokens: 1400 })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'OpenAI API 요청에 실패했습니다.');
  const text = data.output_text || data.output?.flatMap(x => x.content || []).find(x => x.type === 'output_text')?.text;
  if (!text) throw new Error('AI 응답에서 폼 데이터를 찾지 못했습니다.');
  const parsed = JSON.parse(text.replace(/^```json\s*|\s*```$/g, ''));
  if (!Array.isArray(parsed.fields) || !parsed.fields.length) throw new Error('AI가 유효한 필드를 만들지 못했습니다. 다시 요청해 주세요.');
  return { title: String(parsed.title || '새 문의 폼').slice(0, 80), fields: parsed.fields.slice(0, 12).map(sanitizeField) };
}

http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/generate-form') {
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 12000) throw new Error('요청이 너무 큽니다.'); }
      const prompt = String(JSON.parse(body).prompt || '').trim();
      if (prompt.length < 4) return send(res, 400, {error:'폼에 필요한 내용을 조금 더 자세히 입력해 주세요.'});
      return send(res, 200, await generateForm(prompt));
    }
    const requestPath = req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
    const file = normalize(join(root, requestPath));
    if (!file.startsWith(root)) return send(res, 403, {error:'허용되지 않은 경로입니다.'});
    const content = await readFile(file);
    res.writeHead(200, {'Content-Type': mime[extname(file)] || 'application/octet-stream'}); res.end(content);
  } catch (error) {
    if (req.url?.startsWith('/api/')) return send(res, 500, {error: error.message || '서버 오류가 발생했습니다.'});
    res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'}); res.end('파일을 찾을 수 없습니다.');
  }
}).listen(port, () => console.log(`CF7 Studio is running at http://localhost:${port}`));
