import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import version from './routes/version.js';

const app = express();
const port = Number(process.env.PORT ?? 3000);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendPath = path.resolve(__dirname, '../../frontend');

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(frontendPath));
app.use(version);

app.get('/api/v1/health', (_req, res) => {
    res.status(200).json({
        success: true,
        data: { service: 'student-organization-system', status: 'ok' },
    });
});

app.get('*splat', (_req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
});

app.listen(port, () => {
    console.log(`Student Organization System listening on ${port}`);
});
