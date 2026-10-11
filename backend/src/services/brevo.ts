type Recipient = { name?: string; email: string };

const apiKey = () => process.env.BREVO_API_KEY?.trim();
const sender = () => {
  const value = process.env.EMAIL_FROM?.trim();
  if (!value) return null;
  const match = value.match(/^(.*)\s*<([^>]+)>$/);
  return match && match[1] && match[2]
    ? { name: match[1].trim(), email: match[2].trim() }
    : { email: value };
};

export async function sendBrevoAnnouncement(input: { subject: string; body: string; recipients: Recipient[] }) {
  const key = apiKey();
  const from = sender();
  if (!key || !from) throw new Error('Brevo is not configured. Set BREVO_API_KEY and EMAIL_FROM in the backend environment.');
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({
      sender: from,
      to: input.recipients,
      subject: input.subject,
      textContent: input.body,
      htmlContent: `<h2>${escapeHtml(input.subject)}</h2><p>${escapeHtml(input.body).replace(/\n/g, '<br>')}</p>`,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 401 && detail.includes('unrecognised IP address')) {
      throw new Error(
        'Brevo rejected this server IP. Add the backend public IP shown in the Brevo error to Brevo Security > Authorised IPs, then restart the backend.',
      );
    }
    throw new Error(`Brevo rejected the announcement (${response.status}): ${detail.slice(0, 300)}`);
  }
}

function escapeHtml(value: string) {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return value.replace(/[&<>"']/g, (character) => entities[character] || character);
}
