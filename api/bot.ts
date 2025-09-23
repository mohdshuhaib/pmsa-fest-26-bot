import type { VercelRequest, VercelResponse } from '@vercel/node';
import { bot } from '../src/botLogic';
import 'dotenv/config';

// Read the stable secret token from environment variables.
const SECRET_TOKEN = process.env.TELEGRAM_WEBHOOK_SECRET;

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