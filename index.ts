import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY || '{}'),
  scopes: [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/drive.readonly',
  ],
});

const drive = google.drive({ version: 'v3', auth });
const calendar = google.calendar({ version: 'v3', auth });

async function runActionA() {
  console.log('🔍 自動化対象のユーザーを探索中...');
  const sharedItems = await drive.files.list({ q: "sharedWithMe", fields: "files(owners)" });
  const targetEmails = Array.from(new Set(sharedItems.data.files?.flatMap(f => f.owners?.map(o => o.emailAddress)).filter((e): e is string => !!e)));

  if (targetEmails.length === 0) return console.log('⚠️ 共有アイテムなし');

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const timeMin = new Date(yesterday.setHours(0, 0, 0, 0)).toISOString();
  const timeMax = new Date(yesterday.setHours(23, 59, 59, 999)).toISOString();

  for (const email of targetEmails) {
    try {
      console.log(`\n--- 🚀 Action A 開始: ${email} ---`);
      const res = await calendar.events.list({ calendarId: email, timeMin, timeMax, singleEvents: true });
      const events = res.data.items || [];

      for (const event of events) {
        const title = event.summary || 'Untitled';
        const caseIdMatch = title.match(/^\d{4}/);
        const folderName = caseIdMatch ? caseIdMatch[0] : title.replace(/[\\/:*?"<>|]/g, '_');
        const dir = path.join('meetings', folderName);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const attachments = event.attachments || [];
        for (const att of attachments) {
          if (att.mimeType === 'application/vnd.google-apps.document') {
            
            // 💡 ここでドライブから「本当のファイル名」を取得
            const fileMetadata = await drive.files.get({
              fileId: att.fileId!,
              fields: 'name'
            });
            const realFileName = fileMetadata.data.name || att.title;
            console.log(`📄 ファイルを発見: ${realFileName} (ID: ${att.fileId})`);

            // 内容をエクスポート
            const driveRes = await drive.files.export({
              fileId: att.fileId!,
              mimeType: 'text/plain',
            });

            const dateStr = yesterday.toISOString().split('T')[0].replace(/-/g, '');
            // 「日付_本当のファイル名.md」で保存
            const safeFileName = `${dateStr}_${realFileName.replace(/[\\/:*?"<>|]/g, '_')}.md`;
            fs.writeFileSync(path.join(dir, safeFileName), driveRes.data as string);
            console.log(`✅ 保存完了: ${dir}/${safeFileName}`);
          }
        }
      }
    } catch (err: any) {
      console.error(`❌ ${email} の処理中にエラーが発生しました:`);
      // 詳細なエラー内容を出力
      console.error(err.message);
      if (err.errors) console.error(JSON.stringify(err.errors, null, 2));
    }
  }
}

runActionA().catch(console.error);
