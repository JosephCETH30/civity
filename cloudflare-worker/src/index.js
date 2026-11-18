// Image editing for the CIVITAS fountain studio. The CIVITAS server sends multipart form data
// (prompt, input_image_0, width, height) with a shared secret; we run FLUX.2 Klein and return base64.
const MODEL = '@cf/black-forest-labs/flux-2-klein-4b';

export default {
  async fetch(req, env) {
    if (req.method !== 'POST') return new Response('POST only', { status: 405 });
    if (!env.SECRET || req.headers.get('x-civitas-secret') !== env.SECRET) return new Response('Forbidden', { status: 403 });
    try {
      const out = await env.AI.run(MODEL, { multipart: { body: req.body, contentType: req.headers.get('content-type') ?? '' } });
      return Response.json({ image: out.image });
    } catch (e) {
      const message = String(e?.message ?? e);
      // Free plan: 10,000 neurons per day; Workers AI reports running out as a limit/capacity error.
      return Response.json({ error: message }, { status: /limit|quota|neuron|exceed|capacity/i.test(message) ? 429 : 502 });
    }
  },
};
