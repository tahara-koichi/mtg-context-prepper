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

/**
 * 💡 絵文字や記号を取り除き、安全なファイル名にする関数
 */
function sanitize(text: string): string {
  return text
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '') // 絵文字削除
    .replace(/[\\/:*?"<>|]/g, '_') // ファイル名に使えない記号を _ に置換
    .trim();
}

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
      console.log(`📅 昨日の予定数: ${events.length}`);

      for (const event of events) {
        const title = event.summary || 'Untitled';
        
        // 💡 【重要】主催者チェック
        if (event.organizer?.email !== email) {
          console.log(`⏩ スキップ: ${title} (主催者ではないため権限がありません)`);
          continue;
        }

        const caseIdMatch = title.match(/^\d{4}/);
        const folderName = caseIdMatch ? caseIdMatch[0] : sanitize(title);
        const dir = path.join('meetings', folderName);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const attachments = event.attachments || [];
        for (const att of attachments) {
          if (att.mimeType === 'application/vnd.google-apps.document') {
            try {
              const fileMetadata = await drive.files.get({ fileId: att.fileId!, fields: 'name' });
              const realFileName = fileMetadata.data.name || att.title;
              const driveRes = await drive.files.export({ fileId: att.fileId!, mimeType: 'text/plain' });

              const dateStr = yesterday.toISOString().split('T')[0].replace(/-/g, '');
              const safeFileName = `${dateStr}_${sanitize(realFileName)}.md`;
              fs.writeFileSync(path.join(dir, safeFileName), driveRes.data as string);
              console.log(`✅ 保存成功: ${dir}/${safeFileName}`);
            } catch (fileErr) {
              console.log(`⚠️ ファイル取得失敗 (ID: ${att.fileId})。権限が不足している可能性があります。`);
            }
          }
        }
      }
    } catch (err: any) {
      console.error(`❌ ${email} の処理中にエラーが発生しました: ${err.message}`);
    }
  }
}

runActionA().catch(console.error);
