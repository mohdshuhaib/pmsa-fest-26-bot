// src/set-webhook.ts

import { Telegraf } from 'telegraf';
import 'dotenv/config';

// Load variables from your .env file
const { BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET } = process.env;

if (!BOT_TOKEN || !TELEGRAM_WEBHOOK_SECRET) {
    throw new Error("BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET must be provided in your .env file!");
}

// Your Vercel app's URL
const WEBHOOK_URL = 'https://5thwafy-sports-gallery-bot.vercel.app/api/bot';

const bot = new Telegraf(BOT_TOKEN);

async function setWebhook() {
    console.log(`Setting webhook to: ${WEBHOOK_URL}`);
    try {
        const result = await bot.telegram.setWebhook(WEBHOOK_URL, {
            secret_token: TELEGRAM_WEBHOOK_SECRET,
        });
        console.log('Success! Webhook was set.', result);
    } catch (error) {
        console.error('ERROR setting webhook:', error);
    }
}

setWebhook();