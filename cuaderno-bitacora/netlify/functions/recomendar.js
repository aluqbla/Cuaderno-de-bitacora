// netlify/functions/recomendar.js
//
// Función serverless que recibe un resumen de los gustos del usuario
// (construido en el propio index.html a partir de su base de datos local)
// y le pide a Claude que genere recomendaciones nuevas.
//
// La clave de API nunca viaja al navegador: vive solo aquí, como variable
// de entorno de Netlify (ANTHROPIC_API_KEY), y esta función corre en el
// servidor de Netlify, no en el dispositivo del usuario.

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Falta configurar ANTHROPIC_API_KEY en Netlify' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (error) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Cuerpo de la petición inválido' }) };
  }

  const { perfil = [], titulosExistentes = [], tipos = ['Película', 'Serie', 'Libro', 'Videojuego'] } = payload;

  const prompt = construirPrompt(perfil, titulosExistentes, tipos);

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const detalle = await response.text();
      return { statusCode: 502, body: JSON.stringify({ error: 'Error al consultar Claude', detalle }) };
    }

    const data = await response.json();
    const textoRespuesta = (data.content || [])
      .filter((bloque) => bloque.type === 'text')
      .map((bloque) => bloque.text)
      .join('\n');

    const recomendaciones = parsearJsonDeRespuesta(textoRespuesta);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recomendaciones }),
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Error inesperado', detalle: String(error) }) };
  }
};

function construirPrompt(perfil, titulosExistentes, tipos) {
  const perfilTexto = perfil.length
    ? perfil.map((p) => `- ${p.tipo}: "${p.titulo}" (nota ${p.nota}/10, género: ${p.genero || 'sin especificar'})`).join('\n')
    : 'No hay valoraciones suficientes todavía.';

  const excluirTexto = titulosExistentes.length ? titulosExistentes.join(', ') : 'ninguno';

  return `Eres un sistema de recomendaciones de entretenimiento. A partir de las valoraciones reales de una persona, sugiere títulos NUEVOS que probablemente le gusten.

Valoraciones más relevantes de la persona (nota sobre 10):
${perfilTexto}

Tipos que debes recomendar: ${tipos.join(', ')}.

IMPORTANTE: no recomiendes ninguno de estos títulos, ya los tiene registrados: ${excluirTexto}.

Responde ÚNICAMENTE con un array JSON (sin texto adicional, sin markdown, sin backticks), donde cada elemento tenga esta forma exacta:
{"titulo": "...", "tipo": "Película|Serie|Libro|Videojuego", "anio": "...", "motivo": "una frase breve explicando por qué encaja con sus gustos"}

Incluye entre 6 y 8 recomendaciones, repartidas entre los tipos solicitados.`;
}

function parsearJsonDeRespuesta(texto) {
  const limpio = texto.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    const parsed = JSON.parse(limpio);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}
