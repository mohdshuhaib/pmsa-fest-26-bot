import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import 'dotenv/config';

const { GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY } = process.env;

if (!GOOGLE_SHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    throw new Error("Missing Google Sheets environment variables!");
}

const serviceAccountAuth = new JWT({
  email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, serviceAccountAuth);

async function getImageSheet() {
    await doc.loadInfo();
    return doc.sheetsByTitle['images'];
}

// Interface for our new data structure
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

// A more generic function to get images based on a column and value
export async function getImages(columnName: 'event_id' | 'chest_no' | 'other_category_name', value: string): Promise<string[]> {
    const sheet = await getImageSheet();
    const rows = await sheet.getRows();
    return rows
        .filter(row => row.get(columnName) === value)
        .map(row => row.get('image_file_id'));
}

// Gets chest numbers for a college based on data already in the sheet
export async function getChestNumbersForCollege(collegeId: string): Promise<{ id: string; name: string }[]> {
    const sheet = await getImageSheet();
    const rows = await sheet.getRows();
    const chestMap = new Map<string, string>();
    rows
        .filter(row => row.get('college_id') === collegeId && row.get('chest_no'))
        .forEach(row => {
            const chestNo = row.get('chest_no');
            chestMap.set(chestNo, `Chest ${chestNo}`);
        });
    return Array.from(chestMap, ([id, name]) => ({ id, name }));
}

// Gets unique category names for the 'Other' section
export async function getOtherCategories(): Promise<{ id: string; name: string }[]> {
    const sheet = await getImageSheet();
    const rows = await sheet.getRows();
    const categoryMap = new Map<string, string>();
    rows
        .filter(row => row.get('category_type') === 'other' && row.get('other_category_name'))
        .forEach(row => {
            const categoryName = row.get('other_category_name');
            categoryMap.set(categoryName, categoryName);
        });
    return Array.from(categoryMap, ([id, name]) => ({ id, name }));
}

export async function clearSheet(): Promise<void> {
    const sheet = await getImageSheet();
    await sheet.clearRows(); // This clears all rows after the header
}