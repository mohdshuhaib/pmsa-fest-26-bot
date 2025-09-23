import type { VercelRequest, VercelResponse } from '@vercel/node';
import { bot } from '../src/botLogic';
import 'dotenv/config';

// CHANGE: Read the stable secret token from environment variables.
const SECRET_TOKEN = process.env.TELEGRAM_WEBHOOK_SECRET;

// Function to set up the webhook
const setupWebhook = async () => {
    // Vercel provides this URL automatically.
    const WEBHOOK_URL = `https://${process.env.VERCEL_URL}/api/bot`;
    try {
        await bot.telegram.setWebhook(WEBHOOK_URL, {
            secret_token: SECRET_TOKEN,
        });
        console.log(`Webhook successfully set to ${WEBHOOK_URL}`);
    } catch (error) {
        console.error('Error setting webhook:', error);
    }
};

// We only need to set the webhook once on the initial deployment
// Vercel provides this environment variable.
if (process.env.VERCEL_ENV === 'production') {
    setupWebhook();
}

// This function is the entry point for Vercel's serverless environment
export default async function handler(req: VercelRequest, res: VercelResponse) {
    try {
        // Verify the request is from Telegram using our stable secret token
        if (req.headers['x-telegram-bot-api-secret-token'] !== SECRET_TOKEN) {
            return res.status(401).send('Unauthorized');
        }
        await bot.handleUpdate(req.body);
    } catch (err) {
        console.error('Error handling Telegram update:', err);
    }
    // Always respond with a 200 OK to Telegram
    res.status(200).send('OK');
}