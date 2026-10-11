import 'dotenv/config';

const bucket = 'receipts';

const getConfig = () => {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error('Supabase Storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.supabase.co')) {
      throw new Error('SUPABASE_URL must be the HTTPS project URL, for example https://<project-ref>.supabase.co.');
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('SUPABASE_URL must')) throw error;
    throw new Error('SUPABASE_URL must be a valid HTTPS Supabase project URL.');
  }
  return { url, key };
};

const headers = (key: string) => ({
  Authorization: `Bearer ${key}`,
  apikey: key,
});

export async function uploadReceipt(path: string, html: string) {
  const { url, key } = getConfig();
  let response: Response;
  try {
    response = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
      method: 'POST',
      headers: {
        ...headers(key),
        'Content-Type': 'text/html; charset=utf-8',
        'x-upsert': 'true',
      },
      body: html,
    });
  } catch (error) {
    throw formatNetworkError(error);
  }
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase receipt upload failed (${response.status}): ${detail.slice(0, 300)}`);
  }
}

export async function createReceiptDownloadUrl(path: string, expiresIn = 3600) {
  const { url, key } = getConfig();
  let response: Response;
  try {
    response = await fetch(`${url}/storage/v1/object/sign/${bucket}/${path}`, {
      method: 'POST',
      headers: {
        ...headers(key),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn }),
    });
  } catch (error) {
    throw formatNetworkError(error);
  }
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase receipt link failed (${response.status}): ${detail.slice(0, 300)}`);
  }
  const payload = await response.json() as { signedURL?: string };
  if (!payload.signedURL) throw new Error('Supabase did not return a receipt download link.');
  return payload.signedURL.startsWith('http') ? payload.signedURL : `${url}/storage/v1${payload.signedURL}`;
}

function formatNetworkError(error: unknown) {
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : '';
  if (code === 'ENOTFOUND') {
    return new Error('Supabase project URL could not be resolved. Verify SUPABASE_URL in backend/.env matches the project URL in Supabase Project Settings.');
  }
  return new Error(`Supabase Storage could not be reached: ${error instanceof Error ? error.message : 'network error'}`);
}
