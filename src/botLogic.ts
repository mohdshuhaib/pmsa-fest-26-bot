import { Telegraf, Markup, Scenes, session, Context } from 'telegraf';
import 'dotenv/config';
import { addImageEntry, getImages, getChestNumbersForCollege, getOtherCategories, clearSheet } from './googleSheets';
import { EVENTS, COLLEGES } from './config';

// CHANGE: Read the new plural variable from .env
const { BOT_TOKEN, ADMIN_TELEGRAM_IDS } = process.env;
if (!BOT_TOKEN) throw new Error('"BOT_TOKEN" env variable is required!');
// CHANGE: Create a list of admin IDs by splitting the string from the .env file
const ADMIN_IDS = ADMIN_TELEGRAM_IDS?.split(',') || [];
if (ADMIN_IDS.length === 0) console.warn('"ADMIN_TELEGRAM_IDS" env variable is not set. Admin commands will be open to everyone.');

// --- TYPES ---
interface MyWizardSession extends Scenes.WizardSessionData {
	file_id?: string;
	event?: { id: string; name: string };
	college?: { id: string; name: string };
	chest_no?: { id: string; name: string };
	other_category_name?: string;
}
type MyContext = Scenes.WizardContext<MyWizardSession>;

// --- HELPER FOR PAGINATION (FOR USERS) ---
const ITEMS_PER_PAGE = 8;
const createPagedKeyboard = (items: { id: string; name: string }[], page: number, category: string, prefix: string) => {
    const pageCount = Math.ceil(items.length / ITEMS_PER_PAGE);
    const start = page * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const paginatedItems = items.slice(start, end);
    const buttons = paginatedItems.map(item => [Markup.button.callback(item.name, `${prefix}_${item.id}`)]);
    const navRow = [];
    if (page > 0) navRow.push(Markup.button.callback('⬅️ Back', `page_${category}_${page - 1}`));
    navRow.push(Markup.button.callback('🏠 Menu', 'main_menu'));
    if (page < pageCount - 1) navRow.push(Markup.button.callback('Next ➡️', `page_${category}_${page + 1}`));
    buttons.push(navRow);
    return Markup.inlineKeyboard(buttons);
};

// --- HELPER TO SHOW A FULL LIST (FOR ADMINS) ---
const createFullKeyboard = (items: { id: string; name: string }[], prefix: string) => {
    const buttons = items.map(item => [Markup.button.callback(item.name, `${prefix}_${item.id}`)]);
    buttons.push([Markup.button.callback('❌ Cancel Upload', 'cancel_upload')]);
    return Markup.inlineKeyboard(buttons);
};

// --- ADMIN WIZARD SCENE ---
const addImageWizard = new Scenes.WizardScene<MyContext>(
    'add-image-wizard',
    (ctx) => {
        ctx.reply('Please upload a photo (as an image or document). Or type /cancel.');
        ctx.wizard.next();
    },
    (ctx: any) => {
        const message = ctx.message;
        const file = message?.photo?.pop() || message?.document;
        if (!file || (message.document && !message.document.mime_type?.startsWith('image'))) {
            ctx.reply('That was not a valid image. Please try again with /add.');
            return ctx.scene.leave();
        }
        ctx.scene.session.file_id = file.file_id;
        ctx.reply('What type of photo is this?', Markup.inlineKeyboard([
            [Markup.button.callback('🏆 Player Photo (Event/College)', 'add_player')],
            [Markup.button.callback('📸 Other Photo (Trophy, Guests, etc.)', 'add_other')],
            [Markup.button.callback('❌ Cancel', 'cancel_upload')]
        ]));
        ctx.wizard.next();
    },
    async (ctx: any) => {
        await ctx.deleteMessage().catch(() => {});
        const selection = ctx.callbackQuery?.data;
        if (selection === 'add_player') {
            await ctx.reply('Select the Event:', createFullKeyboard(EVENTS, 'select_event'));
            return ctx.wizard.next();
        }
        if (selection === 'add_other') {
            await ctx.reply('Please type a category name for this photo (e.g., Trophies, Guests).');
            return ctx.wizard.selectStep(6);
        }
    },
    async (ctx: any) => {
        const eventId = ctx.callbackQuery?.data.replace('select_event_', '');
        if (!eventId) return;
        ctx.scene.session.event = EVENTS.find(e => e.id === eventId);
        await ctx.deleteMessage().catch(() => {});
        await ctx.reply('Select the College:', createFullKeyboard(COLLEGES, 'select_college'));
        ctx.wizard.next();
    },
    async (ctx: any) => {
        const collegeId = ctx.callbackQuery?.data.replace('select_college_', '');
        if (!collegeId) return;
        ctx.scene.session.college = COLLEGES.find(c => c.id === collegeId);
        await ctx.deleteMessage().catch(() => {});
        await ctx.reply('Please type the participant\'s Chest Number (e.g., 1054).');
        ctx.wizard.next();
    },
    async (ctx: any) => {
        const chestNo = ctx.message?.text;
        if (!chestNo || !/^\d+$/.test(chestNo)) {
            ctx.reply('Invalid Chest Number. Please type a valid number.');
            return;
        }
        ctx.scene.session.chest_no = { id: chestNo, name: `Chest ${chestNo}` };
        const { file_id, event, college } = ctx.scene.session;
        try {
            await addImageEntry({
                image_file_id: file_id!, category_type: 'player',
                event_id: event!.id, event_name: event!.name,
                college_id: college!.id, college_name: college!.name,
                chest_no: chestNo,
            });
            await ctx.reply('✅ Success! Player photo has been added.');
        } catch (e) { console.error(e); await ctx.reply('❌ An error occurred.'); }
        return ctx.scene.leave();
    },
    async (ctx: any) => {
        const categoryName = ctx.message?.text;
        if (!categoryName) return;
        try {
            await addImageEntry({ image_file_id: ctx.scene.session.file_id!, category_type: 'other', other_category_name: categoryName });
            await ctx.reply(`✅ Success! Photo added to the "${categoryName}" category.`);
        } catch (e) { console.error(e); await ctx.reply('❌ An error occurred.'); }
        return ctx.scene.leave();
    }
);

const cancelHandler = async (ctx: any) => {
    await ctx.deleteMessage().catch(() => {});
    await ctx.reply('You have cancelled the upload. To start adding click this /add');
    return ctx.scene.leave();
};
addImageWizard.action('cancel_upload', cancelHandler);
addImageWizard.command('cancel', (ctx) => {
    ctx.reply('You have cancelled the upload. To start adding click this /add');
    return ctx.scene.leave();
});

// --- BOT SETUP ---
export const bot = new Telegraf<MyContext>(BOT_TOKEN);
const stage = new Scenes.Stage<MyContext>([addImageWizard]);
bot.use(session());
bot.use(stage.middleware());

// CHANGE: A simple helper function to check if a user is an admin
const isAdmin = (ctx: Context) => ADMIN_IDS.includes(ctx.from?.id.toString() || '');

// --- ADMIN COMMANDS ---
bot.command('clearsheet', async (ctx) => {
    // CHANGE: Use the new isAdmin function for the check
    if (!isAdmin(ctx)) {
        return ctx.reply("⛔ You don't have permission to do this.");
    }
    try {
        await ctx.reply('🗑️ Are you sure you want to delete ALL image records from the sheet? This cannot be undone.',
            Markup.inlineKeyboard([
                Markup.button.callback('YES, DELETE ALL', 'confirm_clear'),
                Markup.button.callback('CANCEL', 'cancel_clear')
            ])
        );
    } catch (e) { console.error(e); }
});

bot.action('confirm_clear', async (ctx) => {
    if (!isAdmin(ctx)) return; // Security check
    await ctx.deleteMessage().catch(()=>{});
    await ctx.reply('Clearing all data... Please wait.');
    try {
        await clearSheet();
        await ctx.reply('✅ Success! All image records have been deleted from the Google Sheet.');
    } catch(e) { await ctx.reply('❌ An error occurred while clearing the sheet.'); console.error(e); }
});

bot.action('cancel_clear', async (ctx) => {
    await ctx.deleteMessage().catch(()=>{});
    await ctx.reply('Clear operation cancelled.');
});

bot.command('add', (ctx) => {
    // CHANGE: Use the new isAdmin function for the check
    if (!isAdmin(ctx)) {
        return ctx.reply("⛔ You don't have permission to add images.");
    }
    ctx.scene.enter('add-image-wizard');
});

// --- USER COMMANDS & MAIN MENU ---
const mainMenuText = 'Welcome! 🏅 Select a category to view photos:';
const mainMenuKeyboard = Markup.keyboard([['🏅 Events', '🎓 Colleges'], ['📸 Other Photos']]).resize();

bot.start((ctx) => ctx.reply(mainMenuText, mainMenuKeyboard));

bot.action('main_menu', async (ctx) => {
    await ctx.deleteMessage().catch(() => {});
    await ctx.reply(mainMenuText, mainMenuKeyboard);
});

// (The rest of the user-facing code remains the same...)

// --- USER-FACING ACTIONS & PAGINATION ---
bot.hears('🏅 Events', (ctx) => {
    ctx.reply('Choose an event:', createPagedKeyboard(EVENTS, 0, 'user_event', 'view_event'));
});
bot.action(/view_event_(.+)/, async (ctx) => {
    await ctx.deleteMessage().catch(() => {});
    const images = await getImages('event_id', ctx.match[1]);
    if (images.length === 0) {
        await ctx.reply('No photos found for this event yet.', Markup.inlineKeyboard([Markup.button.callback('🔙 Back to Events', 'back_to_events')]));
        return;
    }
    for (const fileId of images) await ctx.replyWithDocument(fileId);
});
bot.action('back_to_events', async(ctx) => {
    await ctx.deleteMessage().catch(() => {});
    await ctx.reply('Choose an event:', createPagedKeyboard(EVENTS, 0, 'user_event', 'view_event'));
});

bot.hears('🎓 Colleges', (ctx) => {
    ctx.reply('Choose a college:', createPagedKeyboard(COLLEGES, 0, 'user_college', 'view_college'));
});
bot.action(/view_college_(.+)/, async (ctx) => {
    await ctx.deleteMessage().catch(() => {});
    const collegeId = ctx.match[1];
    const chestNumbers = await getChestNumbersForCollege(collegeId);
    if (chestNumbers.length === 0) {
        await ctx.reply('No photos found for this college yet.', Markup.inlineKeyboard([Markup.button.callback('🔙 Back to Colleges', 'back_to_colleges')]));
        return;
    }
    ctx.reply('This college has photos for the following participants. Choose one:',
        createPagedKeyboard(chestNumbers, 0, `user_chest_${collegeId}`, 'view_chest'));
});
bot.action('back_to_colleges', async(ctx) => {
    await ctx.deleteMessage().catch(() => {});
    await ctx.reply('Choose a college:', createPagedKeyboard(COLLEGES, 0, 'user_college', 'view_college'));
});

bot.action(/view_chest_(.+)/, async (ctx) => {
    await ctx.deleteMessage().catch(() => {});
    const images = await getImages('chest_no', ctx.match[1]);
    if (images.length === 0) return ctx.answerCbQuery('No photos found for this participant.');
    for (const fileId of images) await ctx.replyWithDocument(fileId);
});

bot.hears('📸 Other Photos', async (ctx) => {
    const categories = await getOtherCategories();
    if (categories.length === 0) return ctx.reply('No "Other" photos have been added yet.');
    ctx.reply('Choose a category:', createPagedKeyboard(categories, 0, 'user_other', 'view_other'));
});
bot.action(/view_other_(.+)/, async (ctx) => {
    await ctx.deleteMessage().catch(() => {});
    const images = await getImages('other_category_name', ctx.match[1]);
    if (images.length === 0) return ctx.answerCbQuery('No photos found for this category.');
    for (const fileId of images) await ctx.replyWithDocument(fileId);
});

bot.action(/page_(.+)_(.+)/, async (ctx) => {
    const [category, pageStr] = ctx.match.slice(1);
    const page = parseInt(pageStr, 10);

    let items: { id: string; name: string }[] = [];
    let prefix = '';
    let text = 'Please select:';

    if (category === 'user_event') { items = EVENTS; prefix = 'view_event'; text = 'Choose an event:'; }
    else if (category === 'user_college') { items = COLLEGES; prefix = 'view_college'; text = 'Choose a college:'; }
    else if (category.startsWith('user_chest')) {
        const collegeId = category.split('_')[2];
        items = await getChestNumbersForCollege(collegeId);
        prefix = 'view_chest';
        text = 'Choose a participant:';
    }
    else if (category === 'user_other') { items = await getOtherCategories(); prefix = 'view_other'; text = 'Choose a category:'; }

    await ctx.deleteMessage().catch(() => {});
    await ctx.reply(text, createPagedKeyboard(items, page, category, prefix));
});