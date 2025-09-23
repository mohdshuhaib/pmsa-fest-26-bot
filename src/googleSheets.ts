// src/googleSheets.ts

import { GoogleSpreadsheet, GoogleSpreadsheetRow } from 'google-spreadsheet';
// We no longer need to import JWT directly
import 'dotenv/config';

const { GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY } = process.env;

if (!GOOGLE_SHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    throw new Error("Missing Google Sheets environment variables!");
}

// We create the doc instance directly without the auth object
const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID);

async function getImageSheet() {
    // Authorize here by passing the credentials directly
    await doc.useServiceAccountAuth({
        client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL!,
        private_key: GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
    });
    await doc.loadInfo();
    return doc.sheetsByTitle['images'];
}

interface ImageEntry {
    image_file_id: string;
    category_type: 'player' | 'other';
    event_id?: string;
    event_name?: string;
    college_id?: string;
    college_name?: string;
    chest_no?: string;
    other_category_name?: string;
}

export async function addImageEntry(entry: ImageEntry): Promise<void> {
    const sheet = await getImageSheet();
    await sheet.addRow({
        image_file_id: entry.image_file_id,
        category_type: entry.category_type,
        event_id: entry.event_id || '',
        event_name: entry.event_name || '',
        college_id: entry.college_id || '',
        college_name: entry.college_name || '',
        chest_no: entry.chest_no || '',
        other_category_name: entry.other_category_name || '',
    });
}

export async function getImages(columnName: 'event_id' | 'chest_no' | 'other_category_name', value: string): Promise<string[]> {
    const sheet = await getImageSheet();
    const rows = await sheet.getRows();
    return rows
        .filter((row: GoogleSpreadsheetRow) => row[columnName] === value)
        .map((row: GoogleSpreadsheetRow) => row['image_file_id']);
}

export async function getChestNumbersForCollege(collegeId: string): Promise<{ id: string; name:string }[]> {
    const sheet = await getImageSheet();
    const rows = await sheet.getRows();
    const chestMap = new Map<string, string>();
    rows
        .filter((row: GoogleSpreadsheetRow) => row['college_id'] === collegeId && row['chest_no'])
        .forEach((row: GoogleSpreadsheetRow) => {
            const chestNo = row['chest_no'];
            chestMap.set(chestNo, `Chest ${chestNo}`);
        });
    return Array.from(chestMap, ([id, name]) => ({ id, name }));
}

export async function getOtherCategories(): Promise<{ id: string; name: string }[]> {
    const sheet = await getImageSheet();
    const rows = await sheet.getRows();
    const categoryMap = new Map<string, string>();
    rows
        .filter((row: GoogleSpreadsheetRow) => row['category_type'] === 'other' && row['other_category_name'])
        .forEach((row: GoogleSpreadsheetRow) => {
            const categoryName = row['other_category_name'];
            categoryMap.set(categoryName, categoryName);
        });
    return Array.from(categoryMap, ([id, name]) => ({ id, name }));
}

export async function clearSheet(): Promise<void> {
    const sheet = await getImageSheet();
    const rows = await sheet.getRows();
    // In this older version, we delete rows by making an array of promises
    await Promise.all(rows.map(row => row.delete()));
}