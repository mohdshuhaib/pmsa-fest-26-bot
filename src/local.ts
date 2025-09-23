import { bot } from './botLogic';

console.log('🤖 Bot is starting in local polling mode...');

// bot.launch() starts the bot using long polling.
// It continuously asks Telegram for new messages.
bot.launch();

// Enable graceful stop on process exit signals.
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

console.log('🚀 Bot is running! Open Telegram and talk to it.');