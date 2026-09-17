const allowedTypes = ['text','email','tel','url','number','textarea','select','checkbox','radio','acceptance','date'];

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

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'POST 요청만 허용됩니다.' });
  try {
    const prompt = String(request.body?.prompt || '').trim();
    if (prompt.length < 4) return response.status(400).json({ error: '폼에 필요한 내용을 조금 더 자세히 입력해 주세요.' });
    if (!process.env.OPENAI_API_KEY) return response.status(500).json({ error: 'Vercel 환경 변수 OPENAI_API_KEY가 설정되지 않았습니다.' });
    const instructions = `You design Korean Contact Form 7 forms. Reply with JSON only, with this exact shape: {"title":"string","fields":[{"type":"text|email|tel|url|number|textarea|select|checkbox|radio|acceptance|date","name":"ascii-kebab-case","label":"Korean label","placeholder":"Korean placeholder","options":"comma-separated options only for select/checkbox/radio","required":true,"phoneFormat":false}]}. Create 3-8 useful fields. Use phoneFormat true only for Korean mobile or phone fields. Include an acceptance field only when the request asks for consent or personal information collection. No markdown.`;
    const apiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-5', instructions, input: prompt, temperature: 0.2, max_output_tokens: 1400 })
    });
    const data = await apiResponse.json();
    if (!apiResponse.ok) throw new Error(data.error?.message || 'OpenAI API 요청에 실패했습니다.');
    const text = data.output_text || data.output?.flatMap(item => item.content || []).find(item => item.type === 'output_text')?.text;
    const parsed = JSON.parse(String(text || '').replace(/^```json\s*|\s*```$/g, ''));
    if (!Array.isArray(parsed.fields) || !parsed.fields.length) throw new Error('AI가 유효한 필드를 만들지 못했습니다.');
    return response.status(200).json({ title: String(parsed.title || '새 문의 폼').slice(0, 80), fields: parsed.fields.slice(0, 12).map(sanitizeField) });
  } catch (error) {
    return response.status(500).json({ error: error.message || '서버 오류가 발생했습니다.' });
  }
}
