// src/googleSheets.ts

import { GoogleSpreadsheet, GoogleSpreadsheetRow } from 'google-spreadsheet';
import 'dotenv/config';

const { GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY } = process.env;

if (!GOOGLE_SHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    throw new Error("Missing Google Sheets environment variables!");
}

const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID);

async function getImageSheet() {
    await doc.useServiceAccountAuth({
        client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL!,
        private_key: GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
    });
    await doc.loadInfo();
    return doc.sheetsByTitle['images']; // Make sure your sheet tab is named 'images'
}

interface ImageEntry {
    media_file_id: string;
    media_type: 'photo' | 'video';
    category_type: 'participant' | 'other_photo' | 'video';
    event_id?: string;
    event_name?: string;
    class_id?: string;
    class_name?: string;
    individual_id?: string;
    individual_name?: string;
    media_category?: string;
}

export async function addMediaEntry(entry: ImageEntry): Promise<void> {
    const sheet = await getImageSheet();
    await sheet.addRow({
        media_file_id: entry.media_file_id,
        media_type: entry.media_type,
        category_type: entry.category_type,
        event_id: entry.event_id || '',
        event_name: entry.event_name || '',
        class_id: entry.class_id || '',
        class_name: entry.class_name || '',
        individual_id: entry.individual_id || '',
        individual_name: entry.individual_name || '',
        media_category: entry.media_category || '',
    });
}

export async function getMedia(
    columnName: 'event_id' | 'class_id' | 'individual_id' | 'media_category',
    value: string,
    mediaType: 'photo' | 'video'
): Promise<string[]> {
    const sheet = await getImageSheet();
    const rows = await sheet.getRows();
    return rows
        // --- FIX: Use row['columnName'] syntax ---
        .filter((row: GoogleSpreadsheetRow) =>
            row[columnName] === value &&
            row['media_type'] === mediaType
        )
        .map((row: GoogleSpreadsheetRow) => row['media_file_id']);
}

export async function getMediaCategories(
    categoryType: 'other_photo' | 'video'
): Promise<{ id: string; name: string }[]> {
    const sheet = await getImageSheet();
    const rows = await sheet.getRows();
    const categoryMap = new Map<string, string>();
    rows
        // --- FIX: Use row['columnName'] syntax ---
        .filter((row: GoogleSpreadsheetRow) =>
            row['category_type'] === categoryType &&
            row['media_category']
        )
        .forEach((row: GoogleSpreadsheetRow) => {
            const categoryName = row['media_category'];
            categoryMap.set(categoryName, categoryName);
        });
    return Array.from(categoryMap, ([id, name]) => ({ id, name }));
}

export async function clearSheet(): Promise<void> {
    const sheet = await getImageSheet();
    const rows = await sheet.getRows();
    await Promise.all(rows.map(row => row.delete()));
}