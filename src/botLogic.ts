// src/botLogic.ts

import { Telegraf, Markup, Scenes, session, Context } from 'telegraf';
import 'dotenv/config';
import { addMediaEntry, getMedia, getMediaCategories, clearSheet } from './googleSheets';
import { EVENTS, CLASSES, INDIVIDUALS } from './config';
import type { InlineQueryResult } from 'telegraf/types';

// --- SETUP AND ADMINS ---
const { BOT_TOKEN, ADMIN_TELEGRAM_IDS } = process.env;
if (!BOT_TOKEN) throw new Error('"BOT_TOKEN" env variable is required!');
const ADMIN_IDS = ADMIN_TELEGRAM_IDS?.split(',') || [];
if (ADMIN_IDS.length === 0) console.warn('"ADMIN_TELEGRAM_IDS" env variable is not set.');

// --- TYPES ---
interface MyWizardSession extends Scenes.WizardSessionData {
    media_file_id?: string;
    media_type?: 'photo' | 'video';
    category_type?: 'participant' | 'other_photo' | 'video';
    event?: { id: string; name: string };
    class?: { id: string; name: string };
    individual?: { id: string; name: string };
    media_category?: string;
}
type MyContext = Scenes.WizardContext<MyWizardSession>;

// --- KEYBOARD HELPERS ---
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

const createCategoryKeyboard = (items: { id: string; name: string }[], prefix: string) => {
    const buttons = items.map(item => [Markup.button.callback(item.name, `${prefix}_${item.id}`)]);
    buttons.push([Markup.button.callback('❌ Cancel Upload', 'cancel_upload')]);
    return Markup.inlineKeyboard(buttons);
};

const createClassKeyboard = () => {
    const buttons = CLASSES.map(c => [Markup.button.callback(c.name, `select_class_${c.id}`)]);
    buttons.push([Markup.button.callback('❌ Cancel Upload', 'cancel_upload')]);
    return Markup.inlineKeyboard(buttons);
};

// --- ADMIN WIZARD SCENE (Single Upload) ---
const addMediaWizard = new Scenes.WizardScene<MyContext>(
    'add-media-wizard',

    // Step 0: Ask for media
    (ctx) => {
        ctx.reply('Please upload a single photo or video. Or /cancel.');
        ctx.wizard.next();
    },

    // Step 1: Get media, ask for category
    (ctx: any) => {
        const message = ctx.message;
        const photo = message?.photo?.pop();
        const document = message?.document;
        const video = message?.video;
        if (photo || (document && document.mime_type?.startsWith('image'))) {
            ctx.scene.session.media_file_id = (photo || document).file_id;
            ctx.scene.session.media_type = 'photo';
        } else if (video) {
            ctx.scene.session.media_file_id = video.file_id;
            ctx.scene.session.media_type = 'video';
        } else {
            ctx.reply('That was not a valid photo or video. Please try again with /add.');
            return ctx.scene.leave();
        }
        if (ctx.scene.session.media_type === 'photo') {
            ctx.reply('What type of photo is this?', Markup.inlineKeyboard([
                [Markup.button.callback('🏆 Participant Photo', 'add_participant')],
                [Markup.button.callback('📸 Other Photo', 'add_other_photo')],
                [Markup.button.callback('❌ Cancel', 'cancel_upload')]
            ]));
        } else {
            ctx.reply('What type of video is this?', Markup.inlineKeyboard([
                [Markup.button.callback('🎬 Event Video', 'add_video')],
                [Markup.button.callback('❌ Cancel', 'cancel_upload')]
            ]));
        }
        ctx.wizard.next();
    },

    // Step 2: Main Branching
    async (ctx: any) => {
        await ctx.deleteMessage().catch(() => {});
        const selection = ctx.callbackQuery?.data;
        if (selection === 'add_participant') {
            ctx.scene.session.category_type = 'participant';
            ctx.reply('Please type the name of the **Event** to search:');
            ctx.wizard.next();
            return;
        }
        if (selection === 'add_other_photo') {
            ctx.scene.session.category_type = 'other_photo';
            const categories = await getMediaCategories('other_photo');
            ctx.reply('Select an existing category, or type a new one (e.g., Trophies, Guests):',
                createCategoryKeyboard(categories, 'select_category'));
            return ctx.wizard.selectStep(6);
        }
        if (selection === 'add_video') {
            ctx.scene.session.category_type = 'video';
            const categories = await getMediaCategories('video');
            ctx.reply('Select an existing video category, or type a new one:',
                createCategoryKeyboard(categories, 'select_category'));
            return ctx.wizard.selectStep(6);
        }
    },

    // Step 3: Search/Select Event
    async (ctx: any) => {
        let selectedEvent: { id: string; name: string } | undefined;
        if (ctx.callbackQuery?.data) {
            const eventId = ctx.callbackQuery.data.replace('select_event_', '');
            selectedEvent = EVENTS.find(e => e.id === eventId);
        } else if (ctx.message?.text) {
            const query = ctx.message.text.toLowerCase();
            const matchingEvents = EVENTS.filter(e => e.name.toLowerCase().includes(query));
            if (matchingEvents.length === 0) return ctx.reply('No events found. Try typing another name:');
            return ctx.reply('Found these events. Select one:', createCategoryKeyboard(matchingEvents, 'select_event'));
        }
        if (selectedEvent) {
            ctx.scene.session.event = selectedEvent;
            await ctx.deleteMessage().catch(() => {});
            ctx.reply(`Event set: ${selectedEvent.name}\n\nNow, select the **Class**:`, createClassKeyboard());
            ctx.wizard.next();
        } else if (!ctx.callbackQuery) {
            ctx.reply('Please type a valid event name.');
        }
    },

    // Step 4: Select Class, then ask for Individual
    async (ctx: any) => {
        const classId = ctx.callbackQuery?.data.replace('select_class_', '');
        if (!classId) return;
        const selectedClass = CLASSES.find(c => c.id === classId);
        if (selectedClass) {
            ctx.scene.session.class = selectedClass;
            await ctx.deleteMessage().catch(() => {});
            ctx.reply(`Class set: ${selectedClass.name}\n\nPlease type the name of the **Individual** to search:`);
            ctx.wizard.next();
        }
    },

    // Step 5: Search/Select Individual & SAVE
    async (ctx: any) => {
        let selectedIndividual: { id: string; name: string } | undefined;
        if (ctx.callbackQuery?.data) {
            await ctx.answerCbQuery();
            const individualId = ctx.callbackQuery.data.replace('select_individual_', '');
            selectedIndividual = INDIVIDUALS.find(i => i.id === individualId);
        } else if (ctx.message?.text) {
            const query = ctx.message.text.toLowerCase();
            const matchingIndividuals = INDIVIDUALS.filter(i => i.name.toLowerCase().includes(query));
            if (matchingIndividuals.length === 0) return ctx.reply('No individuals found. Try typing another name:');
            return ctx.reply('Found these individuals. Select one:', createCategoryKeyboard(matchingIndividuals, 'select_individual'));
        }

        if (selectedIndividual) {
            ctx.scene.session.individual = selectedIndividual;
            await ctx.deleteMessage().catch(() => {});
            const { media_file_id, media_type, category_type, event, class: sceneClass, individual } = ctx.scene.session;
            if (!media_file_id || !media_type || !category_type || !event || !sceneClass || !individual) {
                console.error('Bot Error: Missing session data in participant save.', ctx.scene.session);
                await ctx.reply('❌ An unexpected error occurred. Session data was missing. Please start over with /add.');
                return ctx.scene.leave();
            }
            try {
                await addMediaEntry({
                    media_file_id: media_file_id, media_type: media_type, category_type: category_type,
                    event_id: event.id, event_name: event.name,
                    class_id: sceneClass.id, class_name: sceneClass.name,
                    individual_id: individual.id, individual_name: individual.name,
                });
                await ctx.reply('✅ Success! Participant photo has been added.');
                return ctx.scene.leave();
            } catch (e) {
                console.error('Google Sheets Error:', e);
                await ctx.reply('❌ An error occurred while saving to the database.');
                return ctx.scene.leave();
            }
        } else if (!ctx.callbackQuery) {
            ctx.reply('Please type a valid name.');
        }
    },

    // Step 6: Get/Save Other Photo or Video Category & SAVE
    async (ctx: any) => {
        let categoryName: string | undefined;
        if (ctx.callbackQuery?.data) {
            await ctx.answerCbQuery();
            categoryName = ctx.callbackQuery.data.replace('select_category_', '');
        } else if (ctx.message?.text) {
            categoryName = ctx.message.text;
        }
        if (categoryName) {
            if (ctx.callbackQuery?.data) await ctx.deleteMessage().catch(() => {});
            const { media_file_id, media_type, category_type } = ctx.scene.session;
            if (!media_file_id || !media_type || !category_type) {
                console.error('Bot Error: Missing session data in other/video save.', ctx.scene.session);
                await ctx.reply('❌ An unexpected error occurred. Session data was missing. Please start over with /add.');
                return ctx.scene.leave();
            }
            try {
                await addMediaEntry({
                    media_file_id: media_file_id, media_type: media_type,
                    category_type: category_type, media_category: categoryName,
                });
                await ctx.reply(`✅ Success! Media added to the "${categoryName}" category.`);
                return ctx.scene.leave();
            } catch (e) {
                console.error('Google Sheets Error:', e);
                await ctx.reply('❌ An error occurred while saving to the database.');
                return ctx.scene.leave();
            }
        } else {
            ctx.reply('Invalid selection. Please click a button or type a new category name.');
        }
    }
);
// --- END OF SINGLE UPLOAD WIZARD ---

// --- BATCH ADD PARTICIPANT WIZARD ---
const batchAddWizard = new Scenes.WizardScene<MyContext>(
    'batch-add-wizard',

    // Step 0: Ask for Event
    (ctx) => {
        ctx.reply('--- Batch Add Participant ---\nFirst, please type the name of the **Event** to search:');
        ctx.wizard.next();
    },

    // Step 1: Select Event, Ask for Class
    async (ctx: any) => {
        let selectedEvent: { id: string; name: string } | undefined;
        if (ctx.callbackQuery?.data) {
            const eventId = ctx.callbackQuery.data.replace('select_event_', '');
            selectedEvent = EVENTS.find(e => e.id === eventId);
        } else if (ctx.message?.text) {
            const query = ctx.message.text.toLowerCase();
            const matchingEvents = EVENTS.filter(e => e.name.toLowerCase().includes(query));
            if (matchingEvents.length === 0) return ctx.reply('No events found. Try typing another name:');
            return ctx.reply('Found these events. Select one:', createCategoryKeyboard(matchingEvents, 'select_event'));
        }
        if (selectedEvent) {
            ctx.scene.session.event = selectedEvent;
            await ctx.deleteMessage().catch(() => {});
            ctx.reply(`Event set: ${selectedEvent.name}\n\nNow, select the **Class**:`, createClassKeyboard());
            ctx.wizard.next();
        } else if (!ctx.callbackQuery) {
            ctx.reply('Please type a valid event name.');
        }
    },

    // Step 2: Select Class, Ask for Individual
    async (ctx: any) => {
        const classId = ctx.callbackQuery?.data.replace('select_class_', '');
        if (!classId) return;
        const selectedClass = CLASSES.find(c => c.id === classId);
        if (selectedClass) {
            ctx.scene.session.class = selectedClass;
            await ctx.deleteMessage().catch(() => {});
            ctx.reply(`Class set: ${selectedClass.name}\n\nPlease type the name of the **Individual** to search:`);
            ctx.wizard.next();
        }
    },

    // Step 3: Select Individual, Enter "Listening Mode"
    async (ctx: any) => {
        let selectedIndividual: { id: string; name: string } | undefined;
        if (ctx.callbackQuery?.data) {
            await ctx.answerCbQuery();
            const individualId = ctx.callbackQuery.data.replace('select_individual_', '');
            selectedIndividual = INDIVIDUALS.find(i => i.id === individualId);
        } else if (ctx.message?.text) {
            const query = ctx.message.text.toLowerCase();
            const matchingIndividuals = INDIVIDUALS.filter(i => i.name.toLowerCase().includes(query));
            if (matchingIndividuals.length === 0) return ctx.reply('No individuals found. Try typing another name:');
            return ctx.reply('Found these individuals. Select one:', createCategoryKeyboard(matchingIndividuals, 'select_individual'));
        }

        if (selectedIndividual) {
            ctx.scene.session.individual = selectedIndividual;
            await ctx.deleteMessage().catch(() => {});
            await ctx.reply(`✅ Batch Mode Active\nAdding all media for:\n- **Individual:** ${selectedIndividual.name}\n- **Event:** ${ctx.scene.session.event!.name}\n- **Class:** ${ctx.scene.session.class!.name}\n\nSend me all the photos or documents now. Type /stop when you are finished.`);
            ctx.wizard.next();
        } else if (!ctx.callbackQuery) {
            ctx.reply('Please type a valid name.');
        }
    },

    // Step 4: The "Catcher" Step
    async (ctx: any) => {
        if (ctx.message?.text === '/stop') {
            await ctx.reply('Batch mode stopped.');
            return ctx.scene.leave();
        }

        const message = ctx.message;
        const photo = message?.photo?.pop();
        const document = message?.document;
        let file_id: string | undefined;
        let media_type: 'photo' | 'video' = 'photo';

        if (photo) {
            file_id = photo.file_id;
        } else if (document && document.mime_type?.startsWith('image')) {
            file_id = document.file_id;
        } else {
            await ctx.reply('Invalid input. Please send a photo/document or type /stop.');
            return;
        }

        if (!file_id) {
            await ctx.reply('❌ Error: Could not get file ID from that media. Please try again.');
            return;
        }

        const { event, class: sceneClass, individual } = ctx.scene.session;
        if (!event || !sceneClass || !individual) {
            await ctx.reply('❌ Error: Session expired. Please start over with /batchadd.');
            return ctx.scene.leave();
        }

        try {
            await addMediaEntry({
                media_file_id: file_id, media_type: media_type, category_type: 'participant',
                event_id: event.id, event_name: event.name,
                class_id: sceneClass.id, class_name: sceneClass.name,
                individual_id: individual.id, individual_name: individual.name,
            });
            // --- FIX: Removed the failing ctx.react() line ---
        } catch (e) {
            console.error('Batch Add Save Error:', e);
            await ctx.reply(`❌ Failed to save ${message.message_id}. Please try again.`);
        }
        return;
    }
);
// --- END OF BATCH ADD WIZARD ---

// --- BATCH ADD CATEGORY WIZARD ---
const batchAddCategoryWizard = new Scenes.WizardScene<MyContext>(
    'batch-add-category-wizard',

    // Step 0: Ask for media type
    (ctx) => {
        ctx.reply('--- Batch Add Category ---\nFirst, what are you batch-uploading?',
            Markup.inlineKeyboard([
                [Markup.button.callback('📸 Other Photos', 'batch_other_photo')],
                [Markup.button.callback('🎬 Videos', 'batch_video')],
                [Markup.button.callback('❌ Cancel', 'cancel_upload')]
            ])
        );
        ctx.wizard.next();
    },

    // Step 1: Ask for category name
    async (ctx: any) => {
        await ctx.deleteMessage().catch(() => {});
        const selection = ctx.callbackQuery?.data;
        let categories: { id: string; name: string }[] = [];

        if (selection === 'batch_other_photo') {
            ctx.scene.session.category_type = 'other_photo';
            ctx.scene.session.media_type = 'photo';
            categories = await getMediaCategories('other_photo');
            ctx.reply('Select an existing "Other Photo" category, or type a new one:');
        } else if (selection === 'batch_video') {
            ctx.scene.session.category_type = 'video';
            ctx.scene.session.media_type = 'video';
            categories = await getMediaCategories('video');
            ctx.reply('Select an existing "Video" category, or type a new one:');
        } else {
            return ctx.scene.leave();
        }

        await ctx.reply('Select or type:', createCategoryKeyboard(categories, 'select_category'));
        ctx.wizard.next();
    },

    // Step 2: Get category, enter "Listening Mode"
    async (ctx: any) => {
        let categoryName: string | undefined;
        if (ctx.callbackQuery?.data) {
            await ctx.answerCbQuery();
            categoryName = ctx.callbackQuery.data.replace('select_category_', '');
        } else if (ctx.message?.text) {
            categoryName = ctx.message.text;
        }

        if (categoryName) {
            ctx.scene.session.media_category = categoryName;
            if (ctx.callbackQuery?.data) await ctx.deleteMessage().catch(() => {});
            await ctx.reply(`✅ Batch Mode Active\nAdding all media for category:\n- **Category:** ${categoryName}\n- **Type:** ${ctx.scene.session.media_type}\n\nSend me all your media now. Type /stop when you are finished.`);
            ctx.wizard.next();
        } else {
            ctx.reply('Invalid selection. Please click a button or type a new category name.');
        }
    },

    // Step 3: The "Catcher" Step
    async (ctx: any) => {
        if (ctx.message?.text === '/stop') {
            await ctx.reply('Batch mode stopped.');
            return ctx.scene.leave();
        }

        const message = ctx.message;
        const { media_type, category_type, media_category } = ctx.scene.session;
        let file_id: string | undefined;

        if (media_type === 'photo') {
            const photo = message?.photo?.pop();
            const document = message?.document;
            if (photo) {
                file_id = photo.file_id;
            } else if (document && document.mime_type?.startsWith('image')) {
                file_id = document.file_id;
            }
        } else if (media_type === 'video') {
            const video = message?.video;
            if (video) {
                file_id = video.file_id;
            }
        }

        if (!file_id) {
            await ctx.reply(`Invalid input. Please send a ${media_type} or type /stop.`);
            return;
        }

        if (!media_category || !category_type) {
            await ctx.reply('❌ Error: Session expired. Please start over with /batchcategory.');
            return ctx.scene.leave();
        }

        try {
            await addMediaEntry({
                media_file_id: file_id,
                media_type: media_type,
                category_type: category_type,
                media_category: media_category,
            });
            // --- FIX: Removed the failing ctx.react() line ---
        } catch (e) {
            console.error('Batch Category Save Error:', e);
            await ctx.reply(`❌ Failed to save ${message.message_id}. Please try again.`);
        }
        return;
    }
);
// --- END OF BATCH CATEGORY WIZARD ---

// --- BOT SETUP ---
export const bot = new Telegraf<MyContext>(BOT_TOKEN);
const stage = new Scenes.Stage<MyContext>([addMediaWizard, batchAddWizard, batchAddCategoryWizard]);
bot.use(session());
bot.use(stage.middleware());

// --- WIZARD HANDLERS ---
const cancelHandler = async (ctx: any) => {
    if (ctx.callbackQuery) await ctx.deleteMessage().catch(() => {});
    await ctx.reply('Upload cancelled. To start adding, click /add, /batchadd, or /batchcategory');
    return ctx.scene.leave();
};
addMediaWizard.action('cancel_upload', cancelHandler);
addMediaWizard.command('cancel', (ctx) => {
    ctx.reply('Upload cancelled.');
    return ctx.scene.leave();
});
batchAddWizard.action('cancel_upload', cancelHandler);
batchAddWizard.command('cancel', (ctx) => {
    ctx.reply('Upload cancelled.');
    return ctx.scene.leave();
});
batchAddCategoryWizard.action('cancel_upload', cancelHandler);
batchAddCategoryWizard.command('cancel', (ctx) => {
    ctx.reply('Upload cancelled.');
    return ctx.scene.leave();
});

const isAdmin = (ctx: Context) => ADMIN_IDS.includes(ctx.from?.id.toString() || '');

// --- ADMIN COMMANDS ---
bot.command('clearsheet', async (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply("⛔ You don't have permission.");
    try {
        await ctx.reply('🗑️ Are you sure you want to delete ALL media records?',
            Markup.inlineKeyboard([
                Markup.button.callback('YES, DELETE ALL', 'confirm_clear'),
                Markup.button.callback('CANCEL', 'cancel_clear')
            ])
        );
    } catch (e) { console.error(e); }
});
bot.action('confirm_clear', async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.deleteMessage().catch(()=>{});
    await ctx.reply('Clearing all data...');
    try {
        await clearSheet();
        await ctx.reply('✅ Success! All media records have been deleted.');
    } catch(e) { await ctx.reply('❌ An error occurred.'); console.error(e); }
});
bot.action('cancel_clear', async (ctx) => {
    await ctx.deleteMessage().catch(()=>{});
    await ctx.reply('Clear operation cancelled.');
});

bot.command('add', (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply("⛔ You don't have permission.");
    ctx.scene.enter('add-media-wizard');
});

bot.command('batchadd', (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply("⛔ You don't have permission.");
    ctx.scene.enter('batch-add-wizard');
});

bot.command('batchcategory', (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply("⛔ You don't have permission.");
    ctx.scene.enter('batch-add-category-wizard');
});

// --- USER COMMANDS & MAIN MENU ---
const mainMenuText = 'Welcome! 🏅 Select a category to view photos:';
const mainMenuKeyboard = Markup.keyboard([
    ['🏅 Events', '🎓 Classes'],
    ['👤 Individuals', '📸 Other Photos'],
    ['🎬 Videos']
]).resize();

bot.start((ctx) => ctx.reply(mainMenuText, mainMenuKeyboard));

bot.action('main_menu', async (ctx) => {
    await ctx.deleteMessage().catch(() => {});
    await ctx.reply(mainMenuText, mainMenuKeyboard);
});

// --- ALL USER-FACING ACTIONS ---
// 1. Events
bot.hears('🏅 Events', (ctx) => {
    ctx.reply('Choose an event:', createPagedKeyboard(EVENTS, 0, 'user_event', 'view_event'));
});
bot.action(/view_event_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.deleteMessage().catch(() => {});
    const images = await getMedia('event_id', ctx.match[1], 'photo');
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

// 2. Classes
bot.hears('🎓 Classes', (ctx) => {
    ctx.reply('Choose a class:', createPagedKeyboard(CLASSES, 0, 'user_class', 'view_class'));
});
bot.action(/view_class_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.deleteMessage().catch(() => {});
    const images = await getMedia('class_id', ctx.match[1], 'photo');
    if (images.length === 0) {
        await ctx.reply('No photos found for this class yet.', Markup.inlineKeyboard([Markup.button.callback('🔙 Back to Classes', 'back_to_classes')]));
        return;
    }
    for (const fileId of images) await ctx.replyWithDocument(fileId);
});
bot.action('back_to_classes', async(ctx) => {
    await ctx.deleteMessage().catch(() => {});
    await ctx.reply('Choose a class:', createPagedKeyboard(CLASSES, 0, 'user_class', 'view_class'));
});

// 3. Individuals (How-To)
bot.hears('👤 Individuals', (ctx) => {
    const botUsername = ctx.me || 'YourBotUsername';
    ctx.reply(
        'To search for an individual, please type a part of their name in the chat.\n\n' +
        `For example, type: @${botUsername} Ajmel\n\n` +
        'You can do this in this chat, or in any other chat!'
    );
});

// 4. Other Photos
bot.hears('📸 Other Photos', async (ctx) => {
    const categories = await getMediaCategories('other_photo');
    if (categories.length === 0) return ctx.reply('No "Other" photos have been added yet.');
    ctx.reply('Choose a category:', createPagedKeyboard(categories, 0, 'user_other', 'view_other'));
});
bot.action(/view_other_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.deleteMessage().catch(() => {});
    const images = await getMedia('media_category', ctx.match[1], 'photo');
    if (images.length === 0) return ctx.answerCbQuery('No photos found for this category.');
    for (const fileId of images) await ctx.replyWithDocument(fileId);
});

// 5. Videos
bot.hears('🎬 Videos', async (ctx) => {
    const categories = await getMediaCategories('video');
    if (categories.length === 0) return ctx.reply('No videos have been added yet.');
    ctx.reply('Choose a video category:', createPagedKeyboard(categories, 0, 'user_video', 'view_video'));
});
bot.action(/view_video_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.deleteMessage().catch(() => {});
    const videos = await getMedia('media_category', ctx.match[1], 'video');
    if (videos.length === 0) return ctx.answerCbQuery('No videos found for this category.');
    for (const fileId of videos) await ctx.replyWithVideo(fileId);
});

// --- INLINE QUERY HANDLER ---
bot.on('inline_query', async (ctx) => {
    const query = ctx.inlineQuery.query.toLowerCase();
    if (!query) return;
    const matchingIndividuals = INDIVIDUALS.filter(person =>
        person.name.toLowerCase().includes(query)
    ).slice(0, 20);
    const results: InlineQueryResult[] = matchingIndividuals.map(person => ({
        type: 'article',
        id: person.id,
        title: person.name,
        input_message_content: {
            message_text: `/view_individual ${person.id}`
        },
        description: `Click to see photos of ${person.name}`
    }));
    await ctx.answerInlineQuery(results, { cache_time: 10 });
});
bot.command('view_individual', async (ctx) => {
    const individualId = ctx.message.text.split(' ')[1];
    if (!individualId) return;
    const images = await getMedia('individual_id', individualId, 'photo');
    if (images.length === 0) {
        await ctx.reply('No photos found for this person yet.');
        return;
    }
    for (const fileId of images) await ctx.replyWithDocument(fileId);
});

// --- GENERIC PAGINATION HANDLER ---
bot.action(/page_(.+)_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const [category, pageStr] = ctx.match.slice(1);
    const page = parseInt(pageStr, 10);
    let items: { id: string; name: string }[] = [];
    let prefix = '';
    let text = 'Please select:';
    if (category === 'user_event') { items = EVENTS; prefix = 'view_event'; text = 'Choose an event:'; }
    else if (category === 'user_class') { items = CLASSES; prefix = 'view_class'; text = 'Choose a class:'; }
    else if (category === 'user_other') { items = await getMediaCategories('other_photo'); prefix = 'view_other'; text = 'Choose a category:'; }
    else if (category === 'user_video') { items = await getMediaCategories('video'); prefix = 'view_video'; text = 'Choose a category:'; }
    await ctx.deleteMessage().catch(() => {});
    await ctx.reply(text, createPagedKeyboard(items, page, category, prefix));
});