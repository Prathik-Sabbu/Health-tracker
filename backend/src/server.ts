import Fastify from 'fastify';
import cors from '@fastify/cors';
import { getHealthMetrics, getHealthMetricsRange } from './db';
import { ingestRoutes } from './ingest';
import { calculateReadiness } from '@health-tracker/shared';

// Create Fastify instance with pretty logs
const app = Fastify({
    logger: true,
});

// Enable CORS for all local/tailscale clients
await app.register(cors, {
    origin: true, // Allows requests from your React PWA
});

// Smoke Test Endpoint (to quickly test if server is alive)
app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
});

// Query Health Metrics for a specific date
app.get<{ Params: { date: string } }>('/api/health/:date', async (request, reply) => {
    const { date } = request.params;
    const metrics = getHealthMetrics(date);

    if (!metrics) {
        return reply.status(404).send({ error: `No metrics found for date: ${date}` });
    }

    return metrics;
});

// Query Health Metrics for a date range (for trends & baseline)
app.get<{ Querystring: { start: string; end: string } }>('/api/health', async (request, reply) => {
    const { start, end } = request.query;
    if (!start || !end) {
        return reply.status(400).send({ error: 'start and end query parameters are required (YYYY-MM-DD)' });
    }
    return getHealthMetricsRange(start, end);
});

// Calculate Readiness Score for a specific date
app.get<{ Params: { date: string } }>('/api/health/:date/readiness', async (request, reply) => {
    const { date } = request.params;
    const today = getHealthMetrics(date);

    if (!today) {
        return reply.status(404).send({ error: `No metrics found for date: ${date}` });
    }

    // Fetch prior 30 days for rolling baseline
    const targetDate = new Date(date);
    const startDate = new Date(targetDate);
    startDate.setDate(startDate.getDate() - 30);
    const startStr = startDate.toISOString().slice(0, 10);

    const history = getHealthMetricsRange(startStr, date).filter(m => m.date < date);
    const readiness = calculateReadiness(today, history);

    return readiness;
});

// Register Ingest Routes
await app.register(ingestRoutes);

// Start the server
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`Server listening on http://${HOST}:${PORT}`);
} catch (err) {
    app.log.error(err);
    process.exit(1);
}